const simplePromisify = (f) => {
  return (...args) => {
    return new Promise((resolve, reject) => {
      args.push((err, result) => {
        if (err) return reject(err)
        resolve(result)
      })
      f.call(this, ...args)
    })
  }
}

const util = require('util')
const promisify = util.promisify || simplePromisify
const fs = require('fs')
const readFileAsync = promisify(fs.readFile)
const writeFileAsync = promisify(fs.writeFile)
const path = require('path')

const createTrackerAsync = promisify(require('npm-package-dl-tracker').create)

const handledErrors = new Set([
  'EACCES', 'EFNOTREG', 'EFZEROLEN', 'ENODATA', 'ENOENT', 'ENOTDIR',
  'EORPHANREF', 'EPERM'
])
const MAPFILE_NAME = 'dltracker.json'

module.exports = create

function removeResolvedSemver(item, map) {
  const pkgVersions = map.semver[item.name]
  delete pkgVersions[item.version]
  if (!Object.keys(pkgVersions).length)
    delete map.semver[item.name]
  // Search for tag table entries orphaned by the above
  if (map.tag && map.tag[item.name]) {
    const pkgTags = map.tag[item.name]
    for (let tag in pkgTags) {
      if (pkgTags[tag].version == item.version)
        delete pkgTags[tag]
    }
    if (!Object.keys(pkgTags).length)
      delete map.tag[item.name]
  }
}

function removeResolvedTag(item, map) {
  const pkgTags = map.tag[item.name]
  delete pkgTags[item.spec]
  if (!Object.keys(pkgTags).length)
    delete map.tag[item.name]
}

function removeResolvedGit(item, map) {
  const pkgCommits = map.git[item.repo]
  if ('spec' in item)
    delete pkgCommits[item.spec]
  else {
    delete pkgCommits[item.commit]
    // Search for ref tag entries orphaned by the above
    for (let ref in pkgCommits) {
      if (pkgCommits[ref].commit == item.commit)
        delete pkgCommits[ref]
    }
  }
  if (!Object.keys(pkgCommits).length)
    delete map.git[item.repo]
}

function newDoctor(tracker) {
  const trackerPath = tracker.path
  let currData
  let dataCache
  let isChanged = false

  // Need to provide the results of dltracker.audit to the user, because
  // that is needed by several functions in the reporter module; but we
  // must protect this module's working data from modification by the user.
  function getDataCopy() {
    const results = dataCache || []
    if (!dataCache) {
      for (let i = 0; i < currData.length; ++i) {
        const item = currData[i]
        if (item.resolved) continue
        // The data property is a shallow object, so this is appropriate:
        const data = Object.assign({}, item.data)
        // The error is already read-only
        results.push({ error: item.error, data: data })
      }
      dataCache = results
    }
    return results
  }
  // TODO: now that we're caching the copy of the working data, we might need
  // to do more to manage it ...

  function getErroredPkgs(type, errCode) {
    const list = []
    for (let i = 0; i < currData.length; ++i) {
      const item = currData[i]
      const itemData = item.data
      if (itemData.type != type) continue
      if (item.error.code == errCode && !item.resolved) {
        list.push(i)
      }
    }
    return list 
  }

  function getUnhandledErroredPkgs(getSemver) {
    const list = []
    for (let i = 0; i < currData.length; ++i) {
      const item = currData[i]
      const itemData = item.data
      if (getSemver && itemData.type != 'semver') continue
      else if (!getSemver && itemData.type == 'semver') continue
      if (handledErrors.has(item.error.code) || item.resolved) continue
      list.push(i)
    }
    return list 
  }

  function getOrphanedRefs(type) {
    const list = []
    for (let i = 0; i < currData.length; ++i) {
      const item = currData[i]
      const itemData = item.data
      if (itemData.type != type) continue
      if (item.error.code == 'EORPHANREF' && !item.resolved) {
        list.push(i)
      }
    }
    return list 
  }

  function markResolved(list) {
    for (let i = 0; i < list.length; ++i) {
      currData[list[i]].resolved = true
    }
    if (list.length) {
      isChanged = true
      dataCache = null
    }
  }

  function saveState() {
    var mapFilepath = path.join(trackerPath, MAPFILE_NAME)
    return readFileAsync(mapFilepath, 'utf8')
    .then(str => {
      // Strip BOM, if any
      if (str.charCodeAt(0) === 0xFEFF) str = str.slice(1)
      const map = JSON.parse(str)

      for (let i = 0; i < currData.length; ++i) {
        const problem = currData[i]
        if (!problem.resolved) continue
        const item = problem.data
        switch (item.type) {
          case 'semver':
            removeResolvedSemver(item, map)
            break
          case 'git':
            removeResolvedGit(item, map)
            break
          case 'tag':
            removeResolvedTag(item, map)
            break
          case 'url':
            delete map.url[item.spec]
            break
        }
        if (!Object.keys(map[item.type]).length)
          delete map[item.type]

        map.doctored = (new Date()).toLocaleString()
      }

      return writeFileAsync(mapFilepath, JSON.stringify(map))
      .then(() => {
        dataCache = null
        isChanged = false
      })
    })
  }

  return new Promise((resolve, reject) => {
    tracker.audit(function(err, data) {
      if (err) return reject(err)
      currData = data
      return resolve({
        getErroredPkgs: getErroredPkgs,
        getUnhandledErroredPkgs: getUnhandledErroredPkgs,
        getOrphanedRefs: getOrphanedRefs,
        markResolved: markResolved,
        saveState: saveState,
        data: () => getDataCopy(),
        isChanged: () => isChanged
      })
    })
  })
}

function create(where) {
  if (where !== undefined && where !== null && typeof where !== 'string')
    throw new TypeError('path must be given as a string')
 
  return createTrackerAsync(where).then(tracker => newDoctor(tracker))
}
