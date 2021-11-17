const assert = require('assert')
const fs = require('fs')

const mkdirp = require('mkdirp')
const npf = require('npm-package-filename')
const rimraf = require('rimraf')

/*
TODO:
* 
*/

function makeCleanDir(dirPath, cb) {
  rimraf(dirPath, function(rmrfErr) {
    if (rmrfErr) return cb(rmrfErr)
    mkdirp(dirPath, function(mkdirpErr) {
      cb(mkdirpErr)
    })
  })
}

function copyFile(from, to, cb) {
  var hadError = false
  function errorOut(err) {
    if (hadError) return
    hadError = true
    cb(err)
  }
  fs.createReadStream(from)
  .once('error', errorOut)
  .pipe(fs.createWriteStream(to, {encoding: null}))
  .once('error', errorOut)
  .once('close', function () {
    if (!hadError) cb()
  })
}

module.exports = {
  makeCleanDir: makeCleanDir,
  copyFile: copyFile
}
