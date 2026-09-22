# Older changes
## 1.0.0 (2026-09-22)
* (René Meyer) Replaced the consumption-based battery control (enable switch, computed discharge limit, heartbeat) with an always-on `StorEdgeControlBlock` channel exposing all nine Global StorEdge Control Block registers, read and write, with no admin configuration
* (René Meyer) Documented the new `StorEdgeControlBlock` channel in the README

## 0.0.3 (2026-09-12)
* (René Meyer) Split documentation into user (README.md) and developer (README_dev.md) guides
* (René Meyer) Documented the alternate Modbus TCP port 1502
* (René Meyer) Stopped versioning generated build output

## 0.0.2 (2026-09-11)
* (René Meyer) initial release
