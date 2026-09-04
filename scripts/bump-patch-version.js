#!/usr/bin/env node
/**
 * Bump patch version in package.json + package-lock.json without npm install.
 * (npm install --package-lock-only is very slow on Windows CI runners.)
 */
const fs = require('fs')

const pkgPath = 'package.json'
const lockPath = 'package-lock.json'

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const parts = String(pkg.version).split('.').map((n) => Number(n))
if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
  throw new Error(`Invalid version: ${pkg.version}`)
}
parts[2] += 1
const version = parts.join('.')

pkg.version = version
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
lock.version = version
if (lock.packages && lock.packages['']) {
  lock.packages[''].version = version
}
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)

process.stdout.write(version)
