#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const { Command } = require('commander')
const inquirer = require('inquirer')
const createDoctor = require('./doctor')
const createReporter = require('./reporter')

const MAPFILE_NAME = 'dltracker.json'
const program = new Command()

const { version: pkgVersion } = require('./package.json')
program.version(pkgVersion)

let currPath
let dr

function reevaluateState(dir) {
  return createDoctor(dir)
  .then(doctor => {
    dr = doctor
    currData = doctor.data()
    if (currData.length) {
      const reporter = createReporter(doctor)
      return reporter.report()
    }
    console.log("\nThis download set is in good health!\nNo changes needed.")
    return false
  })
}

function requestConfirmation(msg) {
  const qName = 'yesNoQ'
  return inquirer.prompt([
    {
      type: 'confirm', name: qName,
      message: msg
    }
  ])
  .then(answers => answers[qName])
}

// TODO:
// * Add menu choices for other problems
// * Implement the operations for those choices

function mainMenu() {
  const menuName = 'actions'
  const choices = [
    { key: 'l', name: 'List current errors', value: 'l' },
    { key: 'x', name: 'eXit', value: 'x' }
  ]
  const missingList = dr.getErroredPkgs('semver', 'ENOENT')
    .concat(dr.getErroredPkgs('git', 'ENOENT'))
    .concat(dr.getErroredPkgs('url', 'ENOENT'))
  if (missingList.length) {
    choices.splice(
      -1, 0, { key: 'm', name: 'remove records of Missing tarballs', value: 'm' }
    )
  }
  const zeroList = dr.getErroredPkgs('semver', 'EFZEROLEN')
    .concat(dr.getErroredPkgs('git', 'EFZEROLEN'))
    .concat(dr.getErroredPkgs('url', 'EFZEROLEN'))
  if (zeroList.length) {
    choices.splice(
      -1, 0, { key: 'z', name: 'remove records of Zero-length tarballs', value: 'z' }
    )
  }
  const noFilenameList = dr.getErroredPkgs('semver', 'ENODATA')
    .concat(dr.getErroredPkgs('git', 'ENODATA'))
    .concat(dr.getErroredPkgs('url', 'ENODATA'))
  if (noFilenameList.length) {
    choices.splice(
      -1, 0, { key: 'f', name: 'remove records missing Filename', value: 'f' }
    )
  }
  const orphanedRefList = dr.getOrphanedRefs('tag')
    .concat(dr.getOrphanedRefs('git'))
  if (orphanedRefList.length) {
    choices.splice(
      -1, 0, { key: 'o', name: 'remove records of Orphaned tags/refs', value: 'o' }
    )
  }
  const noVersionList = dr.getErroredPkgs('tag', 'ENODATA')
    .concat(dr.getErroredPkgs('git', 'ENODATA'))
  if (noVersionList.length) {
    choices.splice(
      -1, 0, { key: 'v', name: 'remove tag/git ref records with no Version', value: 'v' }
    )
  }
  if (dr.isChanged()) {
    choices.splice(
      -1, 0, { key: 's', name: 'Save changes', value: 's' }
    )
  }

  return inquirer.prompt([
    {
      type: 'expand', name: menuName, message: 'Action:',
      choices: choices
    }
  ])
  .then(answers => {
    const menuChoice = answers[menuName]
    let result
    switch (menuChoice) {
      case 'l':
        result = Promise.resolve(createReporter(dr).report())
        break;
      case 'm':
        result = requestConfirmation(
          'Confirm: remove records for all missing tarballs?'
        )
        .then(yes => {
          if (yes) {
            dr.markResolved(missingList)
          }
          return true
        })
        break;
      case 'z':
        result = requestConfirmation(
          'Confirm: remove records for all zero-length tarballs?'
        )
        .then(yes => {
          if (yes) {
            dr.markResolved(zeroList)
            console.log(
              "The records are removed.\nYou should delete the zero-length files."
            )
          }
          return true
        })
        break;
      case 'f':
        result = requestConfirmation(
          'Confirm: remove records that have no filename?'
        )
        .then(yes => {
          if (yes) {
            dr.markResolved(noFilenameList)
          }
          return true
        })
        break;
      case 'o':
        result = requestConfirmation(
          'Confirm: remove records for all orphaned tags/refs?'
        )
        .then(yes => {
          if (yes) {
            dr.markResolved(orphanedRefList)
          }
          return true
        })
        break;
      case 'v':
        result = requestConfirmation(
          'Confirm: remove tag/git ref records that have no version?'
        )
        .then(yes => {
          if (yes) {
            dr.markResolved(noVersionList)
          }
          return true
        })
        break;
      case 's':
        result = dr.saveState()
        .catch(err => {
          console.error("Failed to save changes:", err.message)
          process.exitCode = 3;
          throw err
        })
        .then(() => {
          console.log("\nChanges saved.\n")
          return reevaluateState(currPath)
          .catch(err => {
            console.error("Failed to refresh the tracker:", err.message)
            process.exitCode = 4;
            throw err
          })
        })
        .catch(err => {
          if (!process.exitCode) process.exitCode = 5;
          console.error("Exiting.")
          return false
        })
        break;
      case 'x':
        if (dr.isChanged()) {
          result = requestConfirmation(
            'There are unsaved changes. Do you really want to exit?'
          )
          .then(abort => abort ? false : true)
        }
        break;
    }
    return result
  })
  .then(stay =>
    stay ? mainMenu() : null
  )
}

// TODO: I'm thinking of an '-a, --autofix' option.
// This would skip the interactive interface.

program
  .option('-r, --report-only', 'report problems and exit immediately')
  .arguments('[where]')
  .action(function(where) {
    if (!where)
      console.warn('No location given. Using current directory.')

    where = where ? path.resolve(where) : path.resolve(MAPFILE_NAME)
    if (!where.endsWith(MAPFILE_NAME))
      where = path.join(where, MAPFILE_NAME)
    currPath = path.parse(where).dir

    // First we check that a dltracker.json exists in the given directory,
    // because the tracker will not tell us; it will automatically try to
    // rebuild one based on the tarballs found there.
    fs.stat(where, function (err, stats) {
      if (err) {
        if (err.code == 'ENOENT')
          console.error(`Failed to find ${MAPFILE_NAME} at given path.`)
        else if (err.code == 'EACCES' || err.code == 'EPERM')
          console.error('You do not have permission to read this directory.')
        else
          console.error(err.code ? err.code + ':' : '', err.message)
        process.exitCode = 1;
        return
      }
      if (!stats.isFile()) {
        // ERROR_FILE_EXISTS == 0x00000050   EEXIST
        // ERROR_BAD_ARGUMENTS == 0x000000A0 "One or more arguments are not correct."
        // ERROR_BAD_PATHNAME == 0x000000A1  "The specified path is invalid."
        // there is an errno named EISDIR (according to nodejs.org)
        console.error(`${MAPFILE_NAME} at this location is not a file.`)
        process.exitCode = 0xA0;
        return
      }
      return Promise.resolve(program.reportOnly)
      .then(reportOnly => {
        const resultPromise = reevaluateState(currPath)
        return reportOnly ? false : resultPromise
      })
      .catch(err => {
        if (err.code == 'EACCES' || err.code == 'EPERM') {
          console.error(`You don't have permission to access ${MAPFILE_NAME} in this directory.`)
          process.exitCode = 2;
        }
        else {
          console.error(err)
          console.error(err.code ? err.code + ':' : '', err.message)
          process.exitCode = 0xFF;
        }
        return false
      })
      .then(stay => stay ? mainMenu() : null)
    })
  })

program.parse(process.argv)
