const path = require('path')

const expect = require('chai').expect
const rimraf = require('rimraf')

const createReporter = require('../reporter')
const createDoctor = require('../doctor')
const createTracker = require('npm-package-dl-tracker').create
const ut = require('./lib/utilities')
const output = require('./lib/output')

const MAPFILE_NAME = 'dltracker.json'
const ASSETS_BASE = './test/assets'

const notDoctors = [ true, 42, "trust me", new Date(), {} ]
const tempDir = path.join(ASSETS_BASE, 'tempDir')
const veryBadJson = path.join(ASSETS_BASE, 'json', 'dltracker_ALL_BAD.json')

describe('reporter submodule of dltracker-doctor', function() {
  it('should export a single function', function() {
    expect(createReporter).to.be.a('function')
  })
  describe('reporter creator misuse', function() {
    it('should throw if given no argument', function() {
      expect(function(){ createReporter() }).to.throw(SyntaxError)
    })
    it('should throw if given argument that is not an instance of dltracker-doctor', function() {
      for (let i = 0; i < notDoctors.length; ++i) {
        const badArg = notDoctors[i]
        expect(function(){ createReporter(badArg) }).to.throw(TypeError)
      }
    })
  })

  describe('reporter creator correct use', function() {
    let currReporter

    before('set up temporary assets', function(done) {
      ut.makeCleanDir(tempDir, function(err) { done(err) })
    })
    after('remove temporary assets', function(done) {
      rimraf(tempDir, function(err) { done(err) })
    })

    it('should not throw when given an existing directory', function(done) {
      createDoctor(tempDir).then(doctor => {
        expect(function(){ currReporter = createReporter(doctor) }).to.not.throw()
        done()
      })
    })
    it('should return an object with a "report" method', function() {
      expect(currReporter).to.be.an('object').that.has.all.keys(['report'])
      expect(currReporter.report).to.be.a('function')
    })

    function getConsoleLogOutput(reporter, allowError) {
      output.capture()
      try {
        expect(reporter.report()).to.be.true
      }
      catch(err) {
        output.release()
        throw err
      }
      output.release()
      if (!allowError) expect(output.getStderrLines()).to.be.empty
      const logOutput = output.getStdoutLines()
      output.clear()
      return logOutput
    }

    describe('report()', function() {
      it('should output that there is nothing to report for a problem-free directory', function() {
        const logOutput = getConsoleLogOutput(currReporter).join('\n')
        expect(logOutput).to.contain('NO MORE PROBLEMS FOUND')
      })

      it('should output a list of problems where they exist', function(done) {
        const tgt = path.join(tempDir, MAPFILE_NAME)
        ut.copyFile(veryBadJson, tgt, function(err) {
          if (err) return done(err)
          createDoctor(tempDir).then(doctor => {
            currReporter = createReporter(doctor)
            const logOutput = getConsoleLogOutput(currReporter).join('\n')
            expect(logOutput).to.not.be.empty
            expect(logOutput).to.not.contain('NO MORE PROBLEMS FOUND')
            expect(logOutput).to.contain('MISSING FILES')
            expect(logOutput).to.contain('NO FILENAME')
            expect(logOutput).to.contain('dummy-pkg')
            done()
          })
          .catch(err => done(err))
        })
      })
    })
  })
})
