/* jslint esversion: 6 */
/* globals: H5P */

var H5P = H5P || {};

H5P.Dictation = function (Audio, Question) {
  'use strict';

  // Used for xAPI title and task description
  const DEFAULT_DESCRIPTION = 'Dictation';

  /**
   * @constructor
   *
   * @param {Object} params - Params from semantics.json.
   * @param {string} contentId - ContentId.
   * @param {Object} contentData - contentData.
   */
  function Dictation(params, contentId, contentData) {
    const that = this;
    // Initialize
    if (!params) {
      return;
    }

    // Inheritance
    Question.call(this, 'dictation');

    this.params = params;
    this.contentId = contentId;
    this.contentData = contentData || {};

    /*
     * this.params.behaviour.enableSolutionsButton and this.params.behaviour.enableRetry are used by
     * contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-8} and
     * {@link https://h5p.org/documentation/developers/contracts#guides-header-9}
     */
    this.params.behaviour.enableSolutionsButton = this.params.behaviour.enableSolutionsButton || false;
    this.params.behaviour.enableRetry = this.params.behaviour.enableRetry || false;

    // Other defaults
    this.params.behaviour.tries = this.params.behaviour.tries || Infinity;
    this.params.behaviour.triesAlternative = this.params.behaviour.triesAlternative || Infinity;

    this.sentences = [];

    // Relevant for building the DOM later (play slowly button)
    const hasAlternatives = this.params.sentences.some(function (sentence) {
      return (sentence.sampleAlternative !== undefined);
    });

    // Create sentence instances
    this.params.sentences = this.params.sentences
      .filter(function (element) {
        return (typeof element.text !== 'undefined' && typeof element.sample !== 'undefined');
      })
      .forEach(function (element, index) {
        that.sentences.push(new H5P.Dictation.Sentence(
          index + 1,
          {
            "sentence": element,
            "audioNotSupported": that.params.l10n.audioNotSupported,
            "tries": that.params.behaviour.tries,
            "triesAlternative": that.params.behaviour.triesAlternative,
            "ignorePunctuation": that.params.behaviour.ignorePunctuation,
            "hasAlternatives": hasAlternatives,
            "a11y": {
              "play": that.params.a11y.ariaPlay,
              "playSlowly": that.params.a11y.ariaPlaySlowly,
              "enterText": that.params.a11y.ariaEnterText,
              "solution": that.params.a11y.ariaSolution,
              "sentence": that.params.a11y.ariaSentence,
              "triesLeft": that.params.a11y.ariaTriesLeft,
              "infinite": that.params.a11y.ariaInfinite
            }
          },
          that.contentId)
        );
      });

    // Score parameters
    this.maxMistakes = this.computeMaxMistakes();
    this.params.behaviour.typoFactor = parseInt(this.params.behaviour.typoFactor) / 100;

    this.mistakesCapped = 0;
    this.isAnswered = false;
  }

  // Extends Question
  Dictation.prototype = Object.create(Question.prototype);
  Dictation.prototype.constructor = Dictation;

  /**
   * Register the DOM elements with H5P.Question.
   */
  Dictation.prototype.registerDomElements = function () {
    const that = this;
    // Set optional media
    var media = this.params.media.type;
    if (media && media.library) {
      var type = media.library.split(' ')[0];
      if (type === 'H5P.Image') {
        if (media.params.file) {
          this.setImage(media.params.file.path, {
            disableImageZooming: this.params.media.disableImageZooming,
            alt: media.params.alt,
            title: media.params.title
          });
        }
      }
      else if (type === 'H5P.Video') {
        if (media.params.sources) {
          this.setVideo(media);
        }
      }
    }

    // Register task introduction text
    if (this.params.taskDescription) {
      this.introduction = document.createElement('div');
      this.introduction.setAttribute('tabindex', '0');
      this.introduction.innerHTML = this.params.taskDescription;
      this.setIntroduction(this.introduction);
    }

    // Build content
    const content = document.createElement('div');
    this.sentences.forEach(function (element) {
      content.appendChild(element.getContent());
    });

    // No content was given
    if (this.sentences.length === 0) {
      const message = document.createElement('div');
      message.classList.add('h5p-dictation-no-content');
      message.innerHTML = 'I really need at least one sound sample and text for it :-)';
      content.appendChild(message);
    }

    // Register content
    this.setContent(content);

    if (this.sentences.length !== 0) {
      // Register Buttons
      this.addButtons();
    }
  };

  /**
   * Add all the buttons that shall be passed to H5P.Question
   */
  Dictation.prototype.addButtons = function () {
    const that = this;

    // Show solution button
    that.addButton('show-solution', that.params.l10n.showSolution, function () {
      that.showSolutions();
    }, false, {}, {});

    // Check answer button
    that.addButton('check-answer', that.params.l10n.checkAnswer, function () {
      that.showEvaluation();
      that.triggerXAPI();
      if (that.params.behaviour.enableRetry && !that.isPassed()) {
        that.showButton('try-again');
      }
      that.isAnswered = true;
    }, true, {}, {});

    // Retry button
    that.addButton('try-again', that.params.l10n.tryAgain, function () {
      that.resetTask();
    }, false, {}, {});
  };

  /**
   * Compute the maximum number of possible mistakes for all sentences.
   *
   * @return {number} Maximum number of possible mistakes.
   */
  Dictation.prototype.computeMaxMistakes = function () {
    return this.sentences
      .map(function (sentence) {
        return sentence.getMaxMistakes();
      })
      .reduce(function (a, b) {
        return a + b;
      }, 0);
  };

  /**
   * Show the evaluation for the input in the text input fields.
   */
  Dictation.prototype.showEvaluation = function () {
    const that = this;

    // Get results of all sentences
    this.results = [];
    this.sentences.forEach(function (element) {
      that.results.push(element.computeResults());
      element.disable();
    });

    // Combine the scores of all sentences
    const score = this.results
      .map(function (element) {
        return element.score;
      })
      .reduce(function (a, b) {
        return {
          added: a.added + b.added,
          missing: a.missing + b.missing,
          typo: a.typo + b.typo,
          wrong: a.wrong + b.wrong,
          match: a.match + b.match
        };
      }, {added: 0, missing: 0, typo: 0, wrong: 0, match: 0});

    // Prepare output
    const mistakesTotal = score.added + score.missing + score.wrong + score.typo * that.params.behaviour.typoFactor;
    this.mistakesCapped = Math.min(mistakesTotal, this.maxMistakes);

    const generalFeedback = (this.params.l10n.generalFeedback || '')
      .replace('@added', score.added)
      .replace('@missing', score.missing)
      .replace('@wrong', score.wrong)
      .replace('@typo', score.typo)
      .replace('@matches', score.match)
      .replace('@total', mistakesTotal)
      .replace('@capped', this.mistakesCapped);

    const textScore = H5P.Question.determineOverallFeedback(
      this.params.overallFeedback, this.getScore() / this.getMaxScore());

    // Output via H5P.Question
    this.setFeedback(
      (generalFeedback + ' ' + textScore).trim(),
      this.getScore(),
      this.getMaxScore(),
      this.params.a11y.ariaYourResult
    );
    this.hideButton('check-answer');
    if (this.params.behaviour.enableSolution) {
      this.showButton('show-solution');
    }

    this.trigger('resize');
  };

  /**
   * Build the solution for one sentence's results.
   * @param {Object} results - Results.
   * @param {Object} results.score - Scores.
   * @param {number} results.score.added - Number of added words added.
   * @param {number} results.score.missing - Number of words missing.
   * @param {number} results.score.typo - Number of words with typing errors.
   * @param {number} results.score.wrong - Number of wrong words.
   * @param {number} results.score.match - Number of mathes.
   * @param {Object[]} results.words - Words.
   * @param {string} results.words[].answer - Answer given.
   * @param {string} results.words[].solution - Correct word.
   * @param {string} results.words[].type - Type of mistake or match.
   * @param {Boolean[]} results.spaces - Spaces for gaps between words.
   * @return {Array} Array of solutions.
   */
  Dictation.prototype.buildSolutions = function (results) {
    const that = this;

    const solutions = [];
    results.forEach(function (result) {
      let correction = [];
      result.words.forEach(function (word, index) {
        correction.push(that.buildWordWrapper(index, word, result));
      });
      solutions.push(correction);
    });
    return solutions;
  };

  /**
   * Build wrapper for single word of a solution.
   *
   * @param {number} index -Tabindex for ARIA.
   * @param {object} word - Word information.
   * @param {string} word.type - Status about missing, typo, ...
   * @param {string} word.solution - Correct spelling of the word.
   * @param {string} word.answer -
   * @param {object} result - Result data.
   */
  Dictation.prototype.buildWordWrapper = function (index, word, result) {
    // General stuff
    const wrapper = document.createElement('span');
    wrapper.classList.add('h5p-wrapper-' + word.type);
    if (result.spaces[index]) {
      wrapper.classList.add('h5p-spacer');
    }
    wrapper.setAttribute('tabindex', (index === 0) ? '0' : '-1');
    wrapper.setAttribute('role', 'listitem');

    // Listeners
    wrapper.addEventListener('focus', function () {
      this.setAttribute('tabindex', '0');
    });
    wrapper.addEventListener('focusout',function () {
      this.setAttribute('tabindex', '-1');
    });
    wrapper.addEventListener('keydown', function (event) {
      switch (event.keyCode) {
        case 37: // Left
        case 38: // Top
          event.preventDefault();
          if (this.previousSibling) {
            this.previousSibling.focus();
          }
          break;
        case 39: // Right
        case 40: // Down
          event.preventDefault();
          if (this.nextSibling) {
            this.nextSibling.focus();
          }
          break;
      }
    });

    // ARIA
    const ariaLabelType = {
      match: this.params.a11y.ariaCorrect,
      wrong: this.params.a11y.ariaWrong,
      typo: this.params.a11y.ariaTypo,
      missing: this.params.a11y.ariaMissing,
      added: this.params.a11y.ariaAdded
    };
    var ariaLabel = (word.type === 'missing') ? word.solution : word.answer;
    ariaLabel = ariaLabel
      .replace(/\./g, this.params.a11y.ariaPeriod)
      .replace(/!/g, this.params.a11y.ariaExclamationPoint)
      .replace(/\?/g, this.params.a11y.ariaQuestionMark)
      .replace(/,/g, this.params.a11y.ariaComma)
      .replace(/'/g, this.params.a11y.ariaSingleQuote)
      .replace(/["|\u201C|\u201E]/g, this.params.a11y.ariaDoubleQuote)
      .replace(/:/g, this.params.a11y.ariaColon)
      .replace(/;/g, this.params.a11y.ariaSemicolon)
      .replace(/\+/g, this.params.a11y.ariaPlus)
      .replace(/-/g, this.params.a11y.ariaMinus)
      .replace(/\*/g, this.params.a11y.ariaAsterisk)
      .replace(/\//g, this.params.a11y.ariaForwardSlash);
    ariaLabel += '. ' + ariaLabelType[word.type];
    wrapper.setAttribute('aria-label', ariaLabel);

    // ScorePoints
    const scorePoints = new H5P.Question.ScorePoints();
    if (word.type === 'wrong' || word.type === 'added' || word.type === 'typo') {
      const answer = document.createElement('span');
      answer.classList.add('h5p-answer-' + word.type);
      answer.innerHTML = word.answer;
      wrapper.appendChild(answer);
    }
    if (word.type !== 'added') {
      const solution = document.createElement('span');
      solution.classList.add('h5p-solution-' + word.type);
      solution.innerHTML = word.solution;
      wrapper.appendChild(solution);
    }
    if (word.type !== 'match') {
      const scoreIndicator = scorePoints.getElement(false);
      if (word.type === 'typo' && this.params.behaviour.typoFactor === 0.5) {
        scoreIndicator.classList.remove('h5p-question-minus-one');
        scoreIndicator.classList.add('h5p-question-minus-one-half');
      }
      if (word.type !== 'typo' || this.params.behaviour.typoFactor > 0) {
        wrapper.appendChild(scoreIndicator);
      }
    }

    return wrapper;
  };

  /**
   * Determine whether the task has been passed by the user.
   *
   * @return {boolean} True if user passed or task is not scored.
   */
  Dictation.prototype.isPassed = function () {
    return (this.mistakesTrimmed === 0);
  };

  /**
   * Check if Dictation has been submitted/input has been given.
   *
   * @return {boolean} True, if answer was given.
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-1}
   */
  Dictation.prototype.getAnswerGiven = function () {
    return this.isAnswered || this.sentences.some(function (sentence) {
      return sentence.getText().length > 0;
    });
  };

  /**
   * Get latest score.
   *
   * @return {number} latest score.
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-2}
   */
  Dictation.prototype.getScore = function () {
    return this.maxMistakes - this.mistakesCapped;
  };

  /**
   * Get maximum possible score.
   * @return {number} Score necessary for mastering.
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-3}
   */
  Dictation.prototype.getMaxScore = function () {
    return this.maxMistakes;
  };

  /**
   * Show solution.
   *
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-4}
   */
  Dictation.prototype.showSolutions = function () {
    const that = this;

    const solutions = this.buildSolutions(this.results);
    solutions.forEach(function (solution, index) {
      that.sentences[index].showSolution(solution);
    });
    that.sentences[0].focusSolution();
    that.trigger('resize');
  };

  /**
   * Reset task.
   *
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-5}
   */
  Dictation.prototype.resetTask = function () {
    this.sentences.forEach(function (sentence) {
      sentence.reset();
      sentence.enable();
      sentence.hideSolution();
    });
    this.removeFeedback();
    this.hideButton('try-again');
    this.hideButton('show-solution');
    this.showButton('check-answer');

    if (this.introduction) {
      this.introduction.focus();
    }
    else {
      this.sentences[0].focus();
    }

    this.mistakesCapped = 0;
    this.isAnswered = false;
  };

  /**
   * Get xAPI data.
   *
   * @return {Object} xAPI statement.
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-6}
   */
  Dictation.prototype.getXAPIData = function () {
    return {
      statement: this.getXAPIAnswerEvent().data.statement
    };
  };

  /**
   * Trigger all necessary xAPI events after evaluation. Might become more.
   */
  Dictation.prototype.triggerXAPI = function () {
    this.trigger(this.getXAPIAnswerEvent());
  };

  /**
   * Build xAPI answer event.
   *
   * @return {H5P.XAPIEvent} xAPI answer event.
   */
  Dictation.prototype.getXAPIAnswerEvent = function () {
    const xAPIEvent = this.createDictationXAPIEvent('answered');

    xAPIEvent.setScoredResult(this.getScore(), this.getMaxScore(), this, true, this.isPassed());
    xAPIEvent.data.statement.result.response = this.sentences
      .map(function (sentence) {
        return sentence.getText();
      })
      .join('[,]');

    return xAPIEvent;
  };

  /**
   * Create an xAPI event for Dictation.
   *
   * @param {string} verb - Short id of the verb we want to trigger.
   * @return {H5P.XAPIEvent} Event template.
   */
  Dictation.prototype.createDictationXAPIEvent = function (verb) {
    const xAPIEvent = this.createXAPIEventTemplate(verb);
    this.extend(
      xAPIEvent.getVerifiedStatementValue(['object', 'definition']),
      this.getxAPIDefinition());
    return xAPIEvent;
  };

  /**
   * Get the xAPI definition for the xAPI object.
   *
   * @return {object} XAPI definition.
   */
  Dictation.prototype.getxAPIDefinition = function () {
    const definition = {};
    definition.name = {'en-US': DEFAULT_DESCRIPTION};
    definition.description = {'en-US': this.getTitle()};
    definition.type = 'http://adlnet.gov/expapi/activities/cmi.interaction';
    definition.interactionType = 'long-fill-in';
    definition.correctResponsesPattern = this.sentences
      .map(function (sentence) {
        return sentence.getCorrectText();
      })
      .join('[,]');

    return definition;
  };

  /**
   * Extend an array just like JQuery's extend.
   *
   * @param {object} arguments - Objects to be merged.
   * @return {object} Merged objects.
   */
  Dictation.prototype.extend = function () {
    for (let i = 1; i < arguments.length; i++) {
      for (let key in arguments[i]) {
        if (arguments[i].hasOwnProperty(key)) {
          if (typeof arguments[0][key] === 'object' && typeof arguments[i][key] === 'object') {
            this.extend(arguments[0][key], arguments[i][key]);
          }
          else {
            arguments[0][key] = arguments[i][key];
          }
        }
      }
    }
    return arguments[0];
  };


  /**
   * Get the xAPI definition for the xAPI object.
   *
   * @return {object} XAPI definition.
   */
  Dictation.prototype.getTitle = function () {
    return (this.params.taskDescription) ? this.params.taskDescription : DEFAULT_DESCRIPTION;
  };

  return Dictation;
}(H5P.Audio, H5P.Question);
