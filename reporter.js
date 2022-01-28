module.exports = create

const drMethodsUsed = [
  'data', 'getErroredPkgs', 'getUnhandledErroredPkgs', 'getOrphanedRefs'
]

function create(dltDoctor) {
  if (dltDoctor == undefined || dltDoctor == null)
    throw new SyntaxError("No argument given")
  if (typeof dltDoctor != 'object' ||
      Object.getPrototypeOf(dltDoctor) != Object.getPrototypeOf({}))
    throw new TypeError("Given argument is not a DlTracker Doctor")
  for (let i = 0; i < drMethodsUsed.length; ++i) {
    const methodName = drMethodsUsed[i]
    if (typeof dltDoctor[methodName] != 'function')
      throw new TypeError(`Given object has no '${methodName}' method`)
  }

  const doctor = dltDoctor
  const colWidths = {}
  ;(function() {
    const dataSet = doctor.data()
    colWidths.semver = getSemverColumnWidths(dataSet)
    colWidths.tag = getTagColumnWidths(dataSet)
    colWidths.gitRef = getGitRefColumnWidths(dataSet)
  })()

  function reportAll() {
    console.log('')
    console.log('------------------------------------------------------------')

    let count = 0
    count += reportForError(['EACCES', 'EPERM'], 'PERMISSION DENIED', doctor, colWidths)
    count += reportForError('ENOENT', 'MISSING FILES', doctor, colWidths)
    count += reportForError('EFZEROLEN', 'ZERO-LENGTH FILES', doctor, colWidths)
    count += reportForError('EFNOTREG', 'NOT REGULAR FILES', doctor, colWidths)
    count += reportGitRepoNotDir(doctor)
    count += reportForError('ENODATA', 'NO FILENAME', doctor, colWidths) // only covers semver, git, & url
    count += reportNoVersionList(doctor, colWidths)
    count += reportOrphanedRefs(doctor, colWidths)
    count += reportUnhandled(doctor, colWidths)

    if (count < 1) {
      console.log('   NO MORE PROBLEMS FOUND')
      console.log('------------------------------------------------------------')
      console.log('')
    }
    return true
  }

  return {
    report: reportAll
  }
}

function getSemverColumnWidths(dataSet) {
  let maxNameLen = 0
  let maxVerLen = 0
  let maxFilenameLen = 0

  for (let i = 0; i < dataSet.length; ++i) {
    const item = dataSet[i]
    const itemData = item.data
    if (itemData.type != 'semver') continue
    if (maxNameLen < itemData.name.length)
      maxNameLen = itemData.name.length
    if (maxVerLen < itemData.version.length)
      maxVerLen = itemData.version.length
    if (itemData.filename && maxFilenameLen < itemData.filename.length)
      maxFilenameLen = itemData.filename.length
  }
  return {
    name: Math.max(maxNameLen, 'Pkg_name'.length) + 3,
    version: Math.max(maxVerLen, 'Version'.length) + 3,
    filename: maxFilenameLen + 3
  }
}

function getTagColumnWidths(dataSet) {
  let maxNameLen = 0
  let maxTagLen = 0
  for (let i = 0; i < dataSet.length; ++i) {
    const item = dataSet[i]
    const itemData = item.data
    if (itemData.type != 'tag') continue
    if (maxNameLen < itemData.name.length)
      maxNameLen = itemData.name.length
    if (maxTagLen < itemData.spec.length)
      maxTagLen = itemData.spec.length
  }
  return {
    name: Math.max(maxNameLen, 'Pkg_name'.length) + 3,
    tag: maxTagLen + 3
  }
}

function getGitRefColumnWidths(dataSet) {
  let maxRepoLen = 0
  let maxTagLen = 0
  for (let i = 0; i < dataSet.length; ++i) {
    const item = dataSet[i]
    const itemData = item.data
    if (itemData.type != 'git') continue
    // Legacy dltracker git data has no 'repo', and 'repoID' instead of 'filename'
    if (!('repo' in itemData) || !('spec' in itemData)) continue
    if (maxRepoLen < itemData.repo.length)
      maxRepoLen = itemData.repo.length
    if (maxTagLen < itemData.spec.length)
      maxTagLen = itemData.spec.length
  }
  return {
    repo: maxRepoLen + 3,
    tag: maxTagLen + 3
  }
}

function formatSemverData(item, colWidths, appendErrorCode) {
  const itemData = item.data
  if (itemData.type !== 'semver') {
    console.error(itemData)
    throw new Error("Don't pass an item to formatSemverData if it's not type semver")
  }
  return [
    (itemData.name || '').padEnd(colWidths.semver.name),
    (itemData.version || '').padEnd(colWidths.semver.version),
    (itemData.filename || '').padEnd(colWidths.semver.filename),
    appendErrorCode ? item.error.code : ''
  ].join('')
}

function formatGitRefData(itemData, colWidths) {
  const result = []
  if (itemData.type != 'git') {
    console.error(itemData)
    throw new Error("Don't pass an item to formatGitRefData if it's not type git")
  }
  return [
    (itemData.repo || '').padEnd(colWidths.gitRef.repo),
    (itemData.spec || '').padEnd(colWidths.gitRef.tag),
    itemData.commit || ''
  ].join('')
}

function formatTagData(itemData, colWidths) {
  const result = []
  if (itemData.type != 'tag') {
    console.error(itemData)
    throw new Error("Don't pass an item to formatTagData if it's not type tag")
  }
  return [
    (itemData.name || '').padEnd(colWidths.tag.name),
    (itemData.spec || '').padEnd(colWidths.tag.tag),
    itemData.version || ''
  ].join('')
}

// Generally, non-semver data field values are too long to put in columns.
function formatNonSemverData(itemData) {
  if (itemData.type === 'semver') {
    console.error(itemData)
    throw new Error("Don't pass an item to formatNonSemverData if it's type semver")
  }
  let result = ''
  if (itemData.type == 'git') {
    if (itemData.repo)
      result = [
        itemData.repo, '#', itemData.commit, ':\n', itemData.filename
      ].join('')
    else if (itemData.repoID)
      result = [
        itemData.cloneURL, '#', itemData.treeish, ':\n', itemData.repoID
      ].join('')
  }
  else if (itemData.type == 'url')
    result = [
      itemData.spec, ':\n', itemData.filename
    ].join('')
  return result
}

function displaySemverHeader(title, colWidths) {
  console.log(`* ${title} - from npm registry`)
  console.log([
    'Pkg_name'.padEnd(colWidths.semver.name, '_'),
    'Version'.padEnd(colWidths.semver.version, '_'),
    'Filename'.padEnd(colWidths.semver.filename, '_')
  ].join(''))
}

function displayOtherHeader(title) {
  console.log(`* ${title} - not from npm registry`)
  console.log('------------------------------------------------------------')
}

function reportForError(errCode, errTitle, doctor, colWidths) {
  const currData = doctor.data()
  let count = 0
  let list = []
  if (typeof errCode === 'string')
    list = doctor.getErroredPkgs('semver', errCode)
  else if (errCode instanceof Array) {
    for (let i = 0; i < errCode.length; ++i)
      list = list.concat(doctor.getErroredPkgs('semver', errCode[i]))
  }
  if (list.length) {
    count += list.length
    list = list.map(idx => formatSemverData(currData[idx], colWidths))
    displaySemverHeader(errTitle, colWidths)
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
    }
    console.log('')
  }

  list = []
  if (typeof errCode === 'string')
    list = doctor.getErroredPkgs('git', errCode)
      .concat(doctor.getErroredPkgs('url', errCode))
  else if (errCode instanceof Array) {
    for (let i = 0; i < errCode.length; ++i)
      list = list.concat(doctor.getErroredPkgs('git', errCode[i]))
        .concat(doctor.getErroredPkgs('url', errCode[i]))
  }
  if (list.length) {
    count += list.length
    list = list.map(idx => formatNonSemverData(currData[idx].data))
    displayOtherHeader(errTitle)
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
      console.log('')
    }
  }
  return count
}

function reportGitRepoNotDir(doctor) {
  const currData = doctor.data()
  let count = 0
  let list = doctor.getErroredPkgs('git', 'ENOTDIR')
  if (list.length) {
    count += list.length
    list = list.map(idx => formatNonSemverData(currData[idx].data))
    console.log('* NOT A DIRECTORY - GIT REPO EXPECTED')
    console.log('------------------------------------------------------------')
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
      console.log('')
    }
  }
  return count
}

function reportUnhandled(doctor, colWidths) {
  const currData = doctor.data()
  let count = 0
  let list = doctor.getUnhandledErroredPkgs(true)
  if (list.length) {
    count += list.length
    list = list.map(idx => formatSemverData(currData[idx], colWidths, true))
    displaySemverHeader('OTHER ERRORS', colWidths)
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
    }
    console.log('')
  }

  list = doctor.getUnhandledErroredPkgs(false)
  if (list.length) {
    count += list.length
    list = list.map(
      idx => {
        const item = currData[idx]
        return [
          formatNonSemverData(item.data), '\n', item.error.code
        ].join('')
      }
    )
    displayOtherHeader('OTHER ERRORS')
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
      console.log('')
    }
  }
  return count
}

function reportOrphanedRefs(doctor, colWidths) {
  const currData = doctor.data()
  let count = 0
  let list = doctor.getOrphanedRefs('tag')
  if (list.length) {
    count += list.length
    list = list.map(idx => formatTagData(currData[idx].data, colWidths))
    console.log('* ORPHANED TAG - npm registry package')
    console.log([
      'Pkg_name'.padEnd(colWidths.tag.name, '_'),
      'Tag'.padEnd(colWidths.tag.tag, '_'),
      'Version'.padEnd(colWidths.semver.version, '_')
    ].join(''))
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
    }
    console.log('')
  }
  list = doctor.getOrphanedRefs('git')
  if (list.length) {
    count += list.length
    list = list.map(idx => formatGitRefData(currData[idx].data, colWidths))
    console.log('* ORPHANED TAG - git repo')
    console.log([
      'Repo'.padEnd(colWidths.gitRef.repo, '_'),
      'Tag'.padEnd(colWidths.gitRef.tag, '_'),
      'Commit'.padEnd(40, '_')
    ].join(''))
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
    }
    console.log('')
  }
  return count
}

function reportNoVersionList(doctor, colWidths) {
  const currData = doctor.data()
  let count = 0
  let list = doctor.getErroredPkgs('tag', 'ENODATA')
  if (list.length) {
    count += list.length
    list = list.map(idx => formatTagData(currData[idx].data, colWidths))
    console.log('* TAG WITH NO VERSION - npm registry package')
    console.log([
      'Pkg_name'.padEnd(colWidths.tag.name, '_'),
      'Tag'.padEnd(colWidths.tag.tag, '_')
    ].join(''))
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
    }
    console.log('')
  }
  list = doctor.getErroredPkgs('git', 'ENODATA')
  if (list.length) {
    count += list.length
    list = list.map(idx => formatGitRefData(currData[idx].data, colWidths))
    console.log('* GIT REF WITH NO VERSION - git repo')
    console.log([
      'Repo'.padEnd(colWidths.gitRef.repo, '_'),
      'Tag'.padEnd(colWidths.gitRef.tag, '_')
    ].join(''))
    for (let i = 0; i < list.length; ++i) {
      console.log(list[i])
    }
    console.log('')
  }
  return count
}
