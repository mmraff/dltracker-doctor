const orig_stdout_write = process.stdout.write
const orig_stderr_write = process.stderr.write

const logLines = []
const errorLines = []

module.exports = {
  capture: capture,
  release: release,
  getStdoutLines: getStdoutLines,
  getStderrLines: getStderrLines,
  clear: clear
}

function capture() {
  // Consider that this call might not be in a try{}, so we would not have
  // a catch(){} to call release(); instead, the error would be caught by
  // mocha (which would be none the wiser), and we would be stuck with no
  // output until the end of the test suite.
  // (I have verified that this happens when the thing that is supposed to
  // give output throws an error. The following can't address that problem,
  // but it's the least we can do if this function is called erroneously.)
  if (process.stdout.write !== orig_stdout_write) {
    process.stdout.write = orig_stdout_write
    process.stderr.write = orig_stderr_write
    throw new Error("Console capture already activated")
  }

  process.stdout.write = function(output) {
    logLines.push(output)
  }
}

function release() {
  if (process.stdout.write === orig_stdout_write)
    throw new Error("Console capture not currently active")

  process.stdout.write = orig_stdout_write
  process.stderr.write = orig_stderr_write
}

function getStdoutLines() {
  return logLines.slice()
}

function getStderrLines() {
  return errorLines.slice()
}

function clear() {
  if (logLines.length) logLines.splice(0, logLines.length)
  if (errorLines.length) errorLines.splice(0, errorLines.length)
}
