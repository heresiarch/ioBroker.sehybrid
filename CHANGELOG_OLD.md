# Older changes
## 1.0.7 (2026-09-23)
* (René Meyer) Pending changes for the next release

## 1.0.6 (2026-09-23)
* (René Meyer) The compiled `build/` folder is now committed to the repository so the adapter can be installed directly from GitHub; dropped the `common.nogit` flag and the `prepublishOnly` build hook
* (René Meyer) Made the adapter logo square (512x512) and reduced its size in the README

## 1.0.5 (2026-09-22)
* (René Meyer) Adopted the canonical full-TypeScript adapter layout: `build/` is no longer committed; the npm package ships it via `prepublishOnly` and `common.nogit`

## 1.0.4 (2026-09-22)
* (René Meyer) Fixed the admin icon and static admin files being excluded from the repository
* (René Meyer) Upgraded the admin UI build tooling to Vite 8
* (René Meyer) Various repository/CI cleanups to satisfy the ioBroker adapter checker

## 1.0.3 (2026-09-22)
- (ioBroker-Bot) Adapter requires admin >= 7.8.23 now.

## 1.0.2 (2026-09-22)
* (René Meyer) Removed the `install:src-admin` npm script from package.json; the package now contains no install-related scripts at all (addresses issue #6)
* (René Meyer) The CI lint job installs admin UI dependencies inline in the workflow instead of via a package.json script

## 1.0.1 (2026-09-22)
* (René Meyer) Removed the `postinstall` hook that ran npm operations on install; the adapter no longer installs any development dependencies on end-user systems
* (René Meyer) Admin UI dependencies are now bootstrapped only during the build (dev/CI), not via a package lifecycle hook

## 1.0.0 (2026-09-22)
* (René Meyer) Replaced the consumption-based battery control (enable switch, computed discharge limit, heartbeat) with an always-on `StorEdgeControlBlock` channel exposing all nine Global StorEdge Control Block registers, read and write, with no admin configuration
* (René Meyer) Documented the new `StorEdgeControlBlock` channel in the README

## 0.0.3 (2026-09-12)
* (René Meyer) Split documentation into user (README.md) and developer (README_dev.md) guides
* (René Meyer) Documented the alternate Modbus TCP port 1502
* (René Meyer) Stopped versioning generated build output

## 0.0.2 (2026-09-11)
* (René Meyer) initial release
