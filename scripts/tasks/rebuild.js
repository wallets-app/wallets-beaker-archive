import { task, series } from 'gulp'
import { join } from 'path'
import run from './util-run.js'
var homedir = require('os').homedir()

function runAsync (...args) {
  return new Promise(resolve => {
    run(...args, resolve)
  })
}

const MODULES_NEEDING_REBUILD = ['sqlite3']

//(cd app && HOME=~/.electron-gyp npm rebuild --runtime=electron --target=11.0.0-beta.18 --disturl=https://electronjs.org/headers --build-from-source); gulp build

task('rebuild', series(async () => {
  // TODO read electron version
  var cwd = join(process.cwd(), '../app')
  console.log(cwd)
  var env = {}
  if (process.platform === 'darwin') {
    env = {
      // required to make spellchecker compile
      CXXFLAGS: '-mmacosx-version-min=10.10',
      LDFLAGS: '-mmacosx-version-min=10.10'
    }
  }
  env.HOME = join(homedir, '.electron-gyp')
  for (let mod of MODULES_NEEDING_REBUILD) {
    await runAsync(`npm rebuild ${mod} --runtime=electron --target=11.0.0-beta.18 --disturl=https://electronjs.org/headers --build-from-source`, {cwd, env, shell: true})
  }
  await runAsync(`npm run build`, {shell: true})
}))