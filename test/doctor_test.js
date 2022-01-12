const path = require('path')

const expect = require('chai').expect
const fs = require('graceful-fs')
const rimraf = require('rimraf')
const tar = require('tar')

const createDoctor = require('../doctor')
const createTracker = require('npm-package-dl-tracker').create
const ut = require('./lib/utilities')

const MAPFILE_NAME = 'dltracker.json'
const ASSETS_BASE = './test/assets'
const doctorMethods = [
  'getErroredPkgs', 'getUnhandledErroredPkgs', 'getOrphanedRefs',
  'markResolved', 'saveState', 'data', 'isChanged'
]
const pkgTypes = [ 'semver', 'tag', 'git', 'url' ]
const handledErrors = [
  'EACCES', 'EFNOTREG', 'EFZEROLEN', 'ENODATA', 'ENOENT', 'ENOTDIR',
  'EORPHANREF', 'EPERM'
]
const badJson = [
  { file: 'dltracker_GIT_NO-FILENAME.json', type: 'git', code: 'ENODATA' },
  { file: 'dltracker_GIT_REF-NO-COMMIT.json', type: 'git', code: 'ENODATA' },
  { file: 'dltracker_GIT_REF-ORPHAN.json', type: 'git', code: 'EORPHANREF' },
  { file: 'dltracker_SEMVER_NO-FILENAME.json', type: 'semver', code: 'ENODATA' },
  { file: 'dltracker_SEMVER-TAG_NO-VERSION.json', type: 'tag', code: 'ENODATA' },
  { file: 'dltracker_TAG_ORPHAN.json', type: 'tag', code: 'EORPHANREF' },
  { file: 'dltracker_URL_NO-FILENAME.json', type: 'url', code: 'ENODATA' }
]
const notStringArgs = [ 42, true, {}, [] ]

// Get a list of the values of all "filename" properties found in
// the JSON file at the given path
function extractFilenames(jsonFilepath, cb) {
  fs.readFile(jsonFilepath, 'utf8', function(err, s) {
    if (err) return cb(err)
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1)
    const list = []
    let map
    try { map = JSON.parse(s) }
    catch (parseErr) { return cb(parseErr) }

    const semverMap = map.semver || {}
    for (let name in semverMap) {
      const versions = semverMap[name]
      for (let ver in versions) {
        if ('filename' in versions[ver])
          list.push(versions[ver].filename)
      }
    }

    const gitMap = map.git || {}
    for (let repo in gitMap) {
      const refs = gitMap[repo]
      for (let ref in refs) {
        if ('filename' in refs[ref])
          list.push(refs[ref].filename)
      }
    }

    const urlMap = map.url || {}
    for (let spec in urlMap) {
      if ('filename' in urlMap[spec])
        list.push(urlMap[spec].filename)
    }
    cb(null, list)
  })
}

// Make a zero-length file and delete a file at the given path.
// The last 2 names in the filenames list will be used, so it
// must have at least 2 names.
function makeSomeFileTrouble(where, filenames) {
  if (filenames.length < 2)
    return Promise.reject(new Error('Not enough files to execute this test as designed.'))
  let idx = filenames.length - 1;
  const filepath1 = path.join(where, filenames[idx])
  const filepath2 = path.join(where, filenames[--idx])
  return new Promise((resolve, reject) => {
    // Make the last file zero length
    fs.writeFile(filepath1, '', function(err) {
      if (err) return reject(err)
      fs.unlink(filepath2, function(err) {
        if (err) return reject(err)
        resolve(null)
      })
    })
  })
}

function getExpectedErrStats(errData) {
  const results = {}
  for (let i = 0; i < errData.length; ++i) {
    const item = errData[i]
    const pkgType = item.data.type
    const errCode = item.error.code
    if (!(pkgType in results))
      results[pkgType] = {}
    const counts = results[pkgType]
    if (!(errCode in counts))
      counts[errCode] = 1
    else counts[errCode]++
  }
  return results
}

describe('doctor module', function() {
  const srcDir = path.join(ASSETS_BASE, 'tarballs')
  const tempDir1 = path.join(ASSETS_BASE, 'dir1')
  const tempDir2 = path.join(ASSETS_BASE, 'dir2')
  const disposableDirs = [ srcDir, tempDir1, tempDir2 ]
  const allTarballNames = []
  let currDoctor

  before('set up test assets', function(done) {
    const allGoodJson = path.join(ASSETS_BASE, 'json', 'dltracker_ALL_GOOD.json')
    extractFilenames(allGoodJson, function(err, filenames) {
      if (err) return done(err)
      if (filenames.length < 1) {
        err = new Error('No filenames found in the "good" JSON?!')
        return done(err)
      }
      allTarballNames.splice(0, 0, ...filenames)

      const tarballPath = path.join(srcDir, filenames[0])
      ut.makeCleanDir(srcDir, function(err) {
        if (err) return done(err)
        const dummyContentPath = path.join(ASSETS_BASE, 'package')
        tar.c(
          { gzip: true, file: tarballPath }, [ dummyContentPath ]
        ).then(() => {
          createOtherTarballs(1) // the first (0) is what we copy from
        }).catch(err => {
          done(err)
        })
      })

      function createOtherTarballs(i) {
        if (i >= filenames.length) return createSpareDir()
        const copyPath = path.join(srcDir, filenames[i])
        ut.copyFile(tarballPath, copyPath, function(err) {
          if (err) return done(err)
          createOtherTarballs(++i)
        })
      }
      function createSpareDir() {
        ut.makeCleanDir(tempDir2, function(err) {
          return done(err)
        })
      }
    })
  })
  after('tear down test assets', function(done) {
    function removeNextDir(i) {
      if (i >= disposableDirs.length) return done()
      rimraf(disposableDirs[i], function(err) {
        if (err) return done(err)
        removeNextDir(++i)
      })
    }
    removeNextDir(0)
  })

  function makePopulatedTestDir(jsonFilename, tarballNames) {
    return new Promise((resolve, reject) => {
      ut.makeCleanDir(tempDir1, function(err) {
        if (err) return reject(err)
        resolve(mockAllDownloads(0))
      })
    })
    function mockAllDownloads(i) {
      if (i >= tarballNames.length) return copyJsonFile()
      const srcFilepath = path.join(srcDir, tarballNames[i])
      const tgtFilepath = path.join(tempDir1, tarballNames[i])
      return new Promise((resolve, reject) => {
        ut.copyFile(srcFilepath, tgtFilepath, function(err) {
          if (err) return reject(err)
          resolve(mockAllDownloads(++i))
        })
      })
    }
    function copyJsonFile() {
      const srcFilepath = path.join(ASSETS_BASE, 'json', jsonFilename)
      const tgtFilepath = path.join(tempDir1, MAPFILE_NAME)
      return new Promise((resolve, reject) => {
        ut.copyFile(srcFilepath, tgtFilepath, function(err) {
          if (err) return reject(err)
          resolve(null)
        })
      })
    }
  }

  const didNotError = new Error('There should have been an error')

  describe('create()', function() {
    it('should reject if given a non-string argument', function(done) {
      function nextNonstring(i) {
        if (i >= notStringArgs.length) return done()
        return createDoctor(notStringArgs[i])
        .then(dr => done(didNotError))
        .catch(err => {
          expect(err).to.be.an.instanceof(TypeError)
          return nextNonstring(i+1)
        })
        .catch(err => done(err))
      }
      nextNonstring(0)
    })

    it('should reject when given a path that does not exist', function(done) {
      createDoctor(path.join(ASSETS_BASE, 'nosuchpath'))
      .then(doctor => {
        const err = new Error('Should have rejected for non-existent path')
        done(err)
      })
      .catch(err => {
        expect(err.code).to.equal('ENOENT')
        done()
      })
    })

    it('should resolve to a doctor instance given an empty directory', function(done) {
      createDoctor(tempDir2).then(doctor => {
        expect(doctor).to.be.an('object').that.has.all.keys(doctorMethods)
        for (let prop in doctor)
          expect(doctor[prop]).to.be.a('function')
        done()
      })
    })

    it('should resolve to a doctor instance given a tracker directory', function(done) {
      makePopulatedTestDir('dltracker_ALL_GOOD.json', allTarballNames)
      .then(() => createDoctor(tempDir1))
      .then(doctor => {
        expect(doctor).to.be.an('object').that.has.all.keys(doctorMethods)
        for (let prop in doctor)
          expect(doctor[prop]).to.be.a('function')

        currDoctor = doctor
        done()
      })
      .catch(err => done(err))
    })
  })

  describe('Instance methods', function() {

    describe('data() returns an array', function() {
      it('should give an empty array for a tracker directory that has no problems', function() {
        expect(currDoctor.data()).to.be.an('array').that.is.empty
      })

      it('should be same as data passed back by tracker.audit()', function(done) {
        // For this one, re-use the test directory populated in the first test;
        // just replace the json file
        function nextBadJsonTest(i) {
          if (i >= badJson.length) return done()
          const src = path.join(ASSETS_BASE, 'json', badJson[i].file)
          const tgt = path.join(tempDir1, MAPFILE_NAME)
          ut.copyFile(src, tgt, function(err) {
            if (err) return done(err)
            createTracker(tempDir1, function(err, tracker) {
              if (err) return done(err)
              tracker.audit(function(err, auditData) {
                createDoctor(tempDir1).then(doctor => {
                  const drData = doctor.data()
                  // The following line fails. It's naive.
                  //expect(drData).to.deep.equal(auditData)
/*
     The problem with that is that the Errors generated by two different runs
     of audit() have different stack traces, so they're never going to be equal
     even when they have the same message and the same code.
     It will work well to use deep equal on the data property,
     but as for the Errors, we only need to compare the codes.
*/
                  expect(drData).to.be.an('array').that.has.lengthOf(auditData.length)
                  for (let j = 0; j < auditData.length; ++j) {
                    const drItem = drData[j]
                    const auditItem = auditData[j]
                    expect(drItem.error.code).to.equal(auditItem.error.code)
                    expect(drItem.data).to.deep.equal(auditItem.data)
                  }
                  nextBadJsonTest(++i)
                })
                .catch(err => done(err))
              })
            })
          })
        }
        nextBadJsonTest(0)
      })

      it('should contain error and data for any missing tarball', function(done) {
        // Reuse the test directory populated in the first test.
        // First ensure that the good json file is put back there.
        const src = path.join(ASSETS_BASE, 'json', 'dltracker_ALL_GOOD.json')
        const tgt = path.join(tempDir1, MAPFILE_NAME)
        ut.copyFile(src, tgt, function(err) {
          if (err) return done(err)
          nextTarballHidingTest(0)
        })

        function nextTarballHidingTest(i) {
          if (i >= allTarballNames.length) return done()

          // Hide a tarball by putting it out into the spare directory
          const oldPath = path.join(tempDir1, allTarballNames[i])
          const newPath = path.join(tempDir2, allTarballNames[i])
          fs.rename(oldPath, newPath, function(err) {
            if (err) return done(err)
            createDoctor(tempDir1).then(doctor => {
              const errData = doctor.data()
              expect(errData).to.be.an('array').that.is.not.empty
              expect(errData[0].error.code).to.equal('ENOENT')
              // Put it back; go to next
              fs.rename(newPath, oldPath, function(err) {
                if (err) return done(err)
                nextTarballHidingTest(++i)
              })
            })
            .catch(err => done(err))
          })
        }
      })

    })

    describe('getErroredPkgs()', function() {
      it('should be empty when no errors of the given code for the given package type', function(done) {
        function nextBadJsonTest(i) {
          if (i >= badJson.length) return done()
          const pkgType = badJson[i].type
          // Use anything but the expected code
          let j = handledErrors.indexOf(badJson[i].code)
          const errCode = handledErrors[j < 1 ? j + 1 : j - 1]
          const src = path.join(ASSETS_BASE, 'json', badJson[i].file)
          const tgt = path.join(tempDir1, MAPFILE_NAME)
          ut.copyFile(src, tgt, function(err) {
            if (err) return done(err)
            createDoctor(tempDir1).then(doctor => {
              const results = doctor.getErroredPkgs(pkgType, errCode)
              expect(results).to.be.an('array').that.is.empty
              nextBadJsonTest(++i)
            })
            .catch(err => done(err))
          })
        }
        nextBadJsonTest(0)
      })

      it('should return correct indices into data for JSON with errors of given code & type', function(done) {
        function nextBadJsonTest(i) {
          if (i >= badJson.length) return done()
          const pkgType = badJson[i].type
          const errCode = badJson[i].code
          const src = path.join(ASSETS_BASE, 'json', badJson[i].file)
          const tgt = path.join(tempDir1, MAPFILE_NAME)
          ut.copyFile(src, tgt, function(err) {
            if (err) return done(err)
            createDoctor(tempDir1).then(doctor => {
              const errData = doctor.data()
              const errIndices = doctor.getErroredPkgs(pkgType, errCode)
              expect(errIndices).to.be.an('array').that.has.lengthOf(1)
              expect(errData[errIndices[0]].data.type).to.equal(pkgType)
              expect(errData[errIndices[0]].error.code).to.equal(errCode)
              nextBadJsonTest(++i)
            })
            .catch(err => done(err))
          })
        }
        nextBadJsonTest(0)
      })

      // At this point, there are all the tarballs and the last of the bad JSON files in tempDir1

      it('should return indices of all expected error data and only that data', function(done) {
        const badJsonFile = 'dltracker_ALL_BAD.json'
        const badJsonPath = path.join(ASSETS_BASE, 'json', badJsonFile)
        extractFilenames(badJsonPath, function(err, list) {
          if (err) return done(err)
          makePopulatedTestDir(badJsonFile, list)
          .then(() => makeSomeFileTrouble(tempDir1, list))
          .then(() => createDoctor(tempDir1))
          .then(doctor => {
            const allErrData = doctor.data()
            const errCodeCounts = getExpectedErrStats(allErrData)
            for (let pkgType in errCodeCounts) {
              const codesForCurrType = errCodeCounts[pkgType]
              for (let errCode in codesForCurrType) {
                const currCount = codesForCurrType[errCode]
                const errIndices = doctor.getErroredPkgs(pkgType, errCode)
                expect(errIndices).to.be.an('array').that.has.lengthOf(currCount)
                // Verify that the indices lead to indicated data
                for (let i = 0; i < errIndices.length; ++i) {
                  const item = allErrData[errIndices[i]]
                  expect(item.data.type).to.equal(pkgType)
                  expect(item.error.code).to.equal(errCode)
                }
              }
            }
            done()
          })
          .catch(err => done(err))
        })
      })
    })

    describe('getOrphanedRefs()', function() {
      // The last test used a JSON file that had an orphaned git ref *and* an
      // orphaned tag, so we leave that JSON in place.
      it('should return indices of all orphaned refs of the given type', function(done) {
        createDoctor(tempDir1).then(doctor => {
          const allErrData = doctor.data()
          const gitErrInds = doctor.getOrphanedRefs('git')
          expect(gitErrInds).to.be.an('array').that.is.not.empty
          // Verify that the indices lead to indicated data
          for (let i = 0; i < gitErrInds.length; ++i) {
            const item = allErrData[gitErrInds[i]]
            expect(item.data.type).to.equal('git')
            expect(item.error.code).to.equal('EORPHANREF')
          }
          const tagErrInds = doctor.getOrphanedRefs('tag')
          expect(tagErrInds).to.be.an('array').that.is.not.empty
          // Verify that the indices lead to indicated data
          for (let i = 0; i < tagErrInds.length; ++i) {
            const item = allErrData[tagErrInds[i]]
            expect(item.data.type).to.equal('tag')
            expect(item.error.code).to.equal('EORPHANREF')
          }
          done()
        })
        .catch(err => done(err))
      })

      it('should return an empty array when there are no orphaned refs of the given type', function(done) {
        const allGoodJson = path.join(ASSETS_BASE, 'json', 'dltracker_ALL_GOOD.json')
        const tgtFilepath = path.join(tempDir1, MAPFILE_NAME)
        ut.copyFile(allGoodJson, tgtFilepath, function(err) {
          if (err) return done(err)
          createDoctor(tempDir1).then(doctor => {
            const gitErrInds = doctor.getOrphanedRefs('git')
            expect(gitErrInds).to.be.an('array').that.is.empty
            const tagErrInds = doctor.getOrphanedRefs('tag')
            expect(tagErrInds).to.be.an('array').that.is.empty
            done()
          })
          .catch(err => done(err))
        })
      })

    })

    describe('markResolved()', function() {
      before('Set up the test directory; set aside a doctor', function(done) {
        const badJsonFile = 'dltracker_ALL_BAD.json'
        const badJsonPath = path.join(ASSETS_BASE, 'json', badJsonFile)
        const tgtFilepath = path.join(tempDir1, MAPFILE_NAME)
        ut.copyFile(badJsonPath, tgtFilepath, done)
      })

      it("should cause each item to not appear in any more error-fetching call results", function(done) {
        nextCodeSeries(0, done)

        function nextCodeSeries(i, cb) {
          if (i >= handledErrors.length) return cb()
          nextTypeTest(0, handledErrors[i], function(err) {
            if (err) return cb(err)
            nextCodeSeries(++i, cb)
          })
        }
        function nextTypeTest(i, errCode, cb) {
          if (i >= pkgTypes.length) return cb()
          createDoctor(tempDir1).then(doctor => {
            let errItems = doctor.getErroredPkgs(pkgTypes[i], errCode)
            if (errItems.length) {
              doctor.markResolved(errItems)
              // Now we should not get any of those items when we ask for that kind again
              errItems = doctor.getErroredPkgs(pkgTypes[i], errCode)
              expect(errItems).to.be.an('array').that.is.empty
            }
            nextTypeTest(++i, errCode, cb)
          })
          .catch(err => cb(err))
        }
      })

      it("should set the 'isChanged' flag if given list has at least one item", function(done) {
        createDoctor(tempDir1).then(doctor => {
          const errItems = doctor.getErroredPkgs('semver', 'ENODATA')
          expect(errItems).to.be.an('array').that.is.not.empty
          expect(doctor.isChanged()).to.be.false
          doctor.markResolved(errItems)
          expect(doctor.isChanged()).to.be.true
          done()
        })
        .catch(err => done(err))
      })
    })

    describe('saveState()', function() {
      it("should correctly save state with resolved items removed after partial corrections", function(done) {
        createDoctor(tempDir1).then(doctor => {
          const gitOrphans = doctor.getErroredPkgs('git', 'EORPHANREF')
          doctor.markResolved(gitOrphans)
          return doctor.saveState().then(() => {
            expect(doctor.isChanged()).to.be.false
            return createDoctor(tempDir1)
          })
        })
        .then(doctor => {
          const allErrData = doctor.data()
          for (let i = 0; i < allErrData.length; ++i) {
            const item = allErrData[i]
            if (item.data.type == 'git')
              expect(item.error.code).not.to.equal('EORPHANREF')
          }
          done()
        })
        .catch(err => done(err))
      })

      it("should result in no remaining problems when called after all items marked resolved", function(done) {
        createDoctor(tempDir1).then(doctor => {
          const allErrData = doctor.data()
          // Of course, this is *not* the approach for users to deal with problems:
          const indices = Object.keys(allErrData)
          doctor.markResolved(indices)
          return doctor.saveState().then(() => {
            expect(doctor.isChanged()).to.be.false
            return createDoctor(tempDir1)
          })
        })
        .then(doctor => {
          expect(doctor.data()).to.be.an('array').that.is.empty
          done()
        })
        .catch(err => done(err))
      })
    })
  })

})
