/* jslint esversion: 6 */
var H5P = H5P || {};

H5P.Dictation = function ($, Audio, Question) {
  'use strict';

  // TODO: xAPI
  // TODO: ARIA

  /**
   * @constructor
   *
   * @param {Object} config - Config from semantics.json.
   * @param {string} contentId - ContentId.
   * @param {Object} contentData - contentData.
   */
  function Dictation(config, contentId, contentData) {
    let that = this;
    // Initialize
    if (!config) {
      return;
    }

    // Inheritance
    Question.call(this, 'dictation');

    this.config = config;
    this.contentId = contentId;
    this.contentData = contentData || {};

    this.config.behaviour.repetitions = this.config.behaviour.repetitions || Infinity;
    this.config.behaviour.typoFactor = this.config.behaviour.typoFactor / 100;
    this.config.behaviour.mistakesPassing = this.config.behaviour.mistakesPassing || 0;
    this.config.behaviour.mistakesMastering = this.config.behaviour.mistakesMastering || 0;


    this.sentences = [];
    this.config.sentences.forEach(function (element) {
      that.sentences.push(new H5P.Dictation.Sentence({
        "sentence": element,
        "audioNotSupported": that.config.audioNotSupported,
        "repetitions": that.config.behaviour.repetitions,
        "ignorePunctuation": that.config.behaviour.ignorePunctuation
      }));
    });
    this.maxMistakes = this.computeMaxMistakes();

    this.percentageMastering = (this.maxMistakes - this.config.behaviour.mistakesMastering) / this.maxMistakes;
    this.percentagePassing = Math.min(this.percentageMastering, (this.maxMistakes - this.config.behaviour.mistakesPassing) / this.maxMistakes);
  }

  // Extends Question
  Dictation.prototype = Object.create(Question.prototype);
  Dictation.prototype.constructor = Dictation;

  /**
   * Register the DOM elements with H5P.Question.
   */
  Dictation.prototype.registerDomElements = function () {

    // Register task introduction text
    this.setIntroduction(this.config.taskDescription);

    // Build content
    let content = document.createElement('div');
    this.sentences.forEach(function (element) {
      content.appendChild(element.getContent());
    });

    // Register content
    this.setContent(content);

    // Register Buttons
    this.addButtons();
  };

  /**
   * Add all the buttons that shall be passed to H5P.Question
   */
  Dictation.prototype.addButtons = function () {
    let that = this;

    // Show solution button
    that.addButton('show-solution', that.config.showSolution, function () {
      that.showSolution();
    }, false, {}, {});

    // Check answer button
    that.addButton('check-answer', that.config.checkAnswer, function () {
      that.showEvaluation();
    }, true, {}, {});

    // Retry button
    that.addButton('try-again', that.config.tryAgain, function () {
      that.reset();
    }, false, {}, {});
  };

  Dictation.prototype.computeMaxMistakes = function () {
    return this.sentences
        .map(function (sentence) {
          return sentence.getMaxMistakes();
        })
        .reduce(function (a, b) {
          return a + b;
        }, 0);
  };

  Dictation.prototype.showEvaluation = function () {
    let that = this;
    this.results = [];
    this.sentences.forEach(function (element) {
      let currentResult = element.computeResults();
      that.results.push(currentResult);
      element.disable();
    });

    let mistakes = this.results.map(function(element) {
      return element.score.added +
          element.score.missing +
          element.score.wrong +
          that.config.behaviour.typoFactor * element.score.typo;
    }).reduce(function (a, b) {
      return a + b;
    }, 0);

    mistakes = Math.min(mistakes, this.maxMistakes);
    let percentageMistakes = Math.min(this.percentageMastering, (this.maxMistakes - mistakes) / this.maxMistakes);

    // TODO: We could offer replacement variables here, need to be documented in semantics
    let textScore = H5P.Question.determineOverallFeedback(
        this.config.overallFeedback, Math.round(percentageMistakes / this.percentageMastering));

    this.setFeedback(
        'You have made ' + mistakes + ' mistakes. ' + textScore, // TODO: make feedback parameter or remove
        Math.round(percentageMistakes / this.percentageMastering * 100),
        this.percentageMastering / this.percentageMastering * 100);

    this.hideButton('check-answer');
    if (this.config.behaviour.enableSolution) {
      this.showButton('show-solution');
    }
    if (percentageMistakes < this.percentageMastering) {
      if (this.config.behaviour.enableRetry) {
        this.showButton('try-again');
      }
    }

    this.trigger('resize');
  };

  Dictation.prototype.showSolution = function () {
    // TODO: Should get the DOM to be shown
    let that = this;
    let solutions = this.buildSolutions(this.results);
    solutions.forEach(function (solution, index) {
      that.sentences[index].showSolution(solution);
    });
    that.trigger('resize');
  };

  Dictation.prototype.reset = function () {
    this.sentences.forEach(function (sentence) {
      sentence.reset();
      sentence.enable();
      sentence.hideSolution();
    });
    this.removeFeedback();
    this.hideButton('try-again');
    this.hideButton('show-solution');
    this.showButton('check-answer');
    this.trigger('resize');
  };

  Dictation.prototype.buildSolutions = function (results) {
    let that = this;
    let output = [];
    results.forEach(function (result) {
      let sentence = '';
      result.words.forEach(function (word, index) {
        // TODO: This can probably be done more elegant ...
        let spacer = (result.spaces[index]) ? ' h5p-spacer' : '';
        if (word.type === 'wrong' || word.type === 'missing' || word.type === 'added') {
          sentence += '<span class="h5p-wrapper-wrong' + spacer + '">';
        }
        else {
          sentence += '<span class="h5p-wrapper-' + word.type + spacer + '">';
        }

        if (word.type === 'wrong') {
          sentence += '<span class="h5p-' + 'added' +'">';
          sentence += word.answer;
          sentence += '</span>';
          sentence += '<span class="h5p-' + 'wrong' +'">';
          sentence += word.solution;
          sentence += '</span>';
        }
        if (word.type === 'added') {
          sentence += '<span class="h5p-' + 'added' +'">';
          sentence += word.answer;
          sentence += '</span>';
        }
        if (word.type === 'missing') {
          sentence += '<span class="h5p-' + 'missing' +'">';
          sentence += word.solution;
          sentence += '</span>';
        }
        if (word.type === 'typo') {
          sentence += '<span class="h5p-' + 'added' +'">';
          sentence += word.answer;
          sentence += '</span>';
          sentence += '<span class="h5p-' + 'typo' +'">';
          sentence += word.solution;
          sentence += '</span>';
        }
        if (word.type === 'match') {
          sentence += '<span class="h5p-' + 'match' +'">';
          sentence += word.solution;
          sentence += '</span>';
        }
        sentence += '</span>';
      });
      output.push(sentence);
    });
    return output;
  };

  /*s
  Dictation.prototype.extend = function () {
    for(let i = 1; i < arguments.length; i++) {
      for(let key in arguments[i]) {
        if (arguments[i].hasOwnProperty(key)) {
          if (typeof arguments[0][key] === 'object' &&
              typeof arguments[i][key] === 'object') {
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
  */
  return Dictation;
}(H5P.jQuery, H5P.Audio, H5P.Question);
