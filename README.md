# dltracker-doctor
CLI to diagnose and fix problems in a dltracker.json file

## Overview
A `dltracker.json` file is created by use of the `download` command provided by [npm-two-stage](https://github.com/mmraff/npm-two-stage#readme).

*Note that the official `npm` interface **does not** have a `download` command at this time.*

For information about the purpose of a `dltracker.json` file, see the [README for npm-download-tracker](https://github.com/mmraff/npm-download-tracker#readme) (a.k.a. the npm package `npm-package-dl-tracker`).

The kinds of problems addressed by this module are unlikely to be seen except in cases of interrupted network connection, file system corruption, or ill-advised manual editing of the JSON file. Of course, access permission issues can be solved by changing permissions or ownership of files.

Understand that the "fix" implemented in this module is always to remove the problematic entry. In some cases this fix itself may lead to problems of two types:
- Missing records of dependencies
- Orphaned dependencies (never get used because the record of the package that depends on them has been removed)

The best way to solve problems with a `dltracker.json` file, and the contents of the directory in which it resides, is to start over with a clean directory and rerun `npm download`.

That being said, read on for instructions.


## To Install

Typical CLI use is from a global installation:
```
$ npm install -g dltracker-doctor
```
But local installation is valid, and possibly useful for the submodules:
```
$ npm install --save dltracker-doctor
```


## Non-interactive Usage
Report problems and exit:
```
$ dlt-dr --report-only DOWNLOAD_PATH
$ dlt-dr -r DOWNLOAD_PATH
```
Show version and exit:
```
$ dlt-dr --version
$ dlt-dr -V
```

## Interactive Usage
Enter the `dlt-dr` command with the path of the directory that contains the `dltracker.json` file.
```
$ dlt-dr DOWNLOAD_PATH
```
If no problems are found, the program exits immediately after displaying this message:
```
This download set is in good health!
No changes needed.
```
... else the first output will be a list of all problems discovered, grouped by category.

This output is followed by a prompt for an **Action**.
- The available actions are represented by single letters.
- Entering `h`, or only pressing Enter, will expand the descriptions of the available actions.
- The `l` action (List) will always be available to display the current state.
- The `x` action (eXit) will always be available.
- Any other action letter will only be available while the type of problem it acts on exists in the loaded JSON.
- Each choice of an action that will result in a change, or choosing `x` to exit when there are unwritten changes, will always be followed by a confirmation prompt, where 'Yes' is the default.
- The `s` action (Save) is only available when there are unsaved changes.
- When all problems have been fixed, the program exits after the Save action is chosen.
------

**License: MIT**
