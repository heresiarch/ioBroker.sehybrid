"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var sunspec_decode_exports = {};
__export(sunspec_decode_exports, {
  applyScaleFactor: () => applyScaleFactor,
  decodeRegisters: () => decodeRegisters,
  encodeFloat32le: () => encodeFloat32le,
  encodeUint32le: () => encodeUint32le,
  isNotImplemented: () => isNotImplemented
});
module.exports = __toCommonJS(sunspec_decode_exports);
const SENTINEL_INT16 = 32768;
const SENTINEL_UINT16 = 65535;
const SENTINEL_INT32 = 2147483648;
const SENTINEL_UINT32 = 4294967295;
function toUint32(hi, lo) {
  return ((hi & 65535) << 16 | lo & 65535) >>> 0;
}
function asInt16(u) {
  const v = u & 65535;
  return v >= 32768 ? v - 65536 : v;
}
function asInt32(u) {
  return u | 0;
}
function isNotImplemented(words, datatype) {
  switch (datatype) {
    case "int16":
    case "sunssf":
      return (words[0] & 65535) === SENTINEL_INT16;
    case "uint16":
      return (words[0] & 65535) === SENTINEL_UINT16;
    case "int32":
      return toUint32(words[0], words[1]) === SENTINEL_INT32;
    case "uint32":
    case "acc32":
      return toUint32(words[0], words[1]) === SENTINEL_UINT32;
    case "uint32le":
      return toUint32(words[0], words[1]) === SENTINEL_UINT32;
    case "uint64":
    case "uint64le":
      return (words[0] & 65535) === 65535 && (words[1] & 65535) === 65535 && (words[2] & 65535) === 65535 && (words[3] & 65535) === 65535;
    case "float32":
    case "float32le":
    case "string":
      return false;
    default:
      return false;
  }
}
function decodeRegisters(words, datatype) {
  if (isNotImplemented(words, datatype)) {
    return null;
  }
  switch (datatype) {
    case "int16":
    case "sunssf":
      return asInt16(words[0]);
    case "uint16":
      return words[0] & 65535;
    case "int32":
      return asInt32(toUint32(words[0], words[1]));
    case "uint32":
    case "acc32":
      return toUint32(words[0], words[1]);
    case "uint32le":
      return toUint32(words[1], words[0]);
    case "float32": {
      const buf = Buffer.allocUnsafe(4);
      buf.writeUInt16BE(words[0] & 65535, 0);
      buf.writeUInt16BE(words[1] & 65535, 2);
      return buf.readFloatBE(0);
    }
    case "float32le": {
      const buf = Buffer.allocUnsafe(4);
      buf.writeUInt16BE(words[1] & 65535, 0);
      buf.writeUInt16BE(words[0] & 65535, 2);
      return buf.readFloatBE(0);
    }
    case "uint64": {
      const hi = toUint32(words[0], words[1]);
      const lo = toUint32(words[2], words[3]);
      return hi * 4294967296 + lo;
    }
    case "uint64le": {
      const hi = toUint32(words[3], words[2]);
      const lo = toUint32(words[1], words[0]);
      return hi * 4294967296 + lo;
    }
    case "string":
      return decodeString(words);
    default:
      return null;
  }
}
function encodeFloat32le(value) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeFloatBE(value, 0);
  const high = buf.readUInt16BE(0);
  const low = buf.readUInt16BE(2);
  return [low, high];
}
function encodeUint32le(value) {
  const v = value >>> 0;
  const low = v & 65535;
  const high = v >>> 16 & 65535;
  return [low, high];
}
function decodeString(words) {
  const buf = Buffer.allocUnsafe(words.length * 2);
  for (let i = 0; i < words.length; i++) {
    buf.writeUInt16BE(words[i] & 65535, i * 2);
  }
  let end = buf.length;
  while (end > 0 && (buf[end - 1] === 0 || buf[end - 1] === 32)) {
    end--;
  }
  return buf.toString("latin1", 0, end);
}
function applyScaleFactor(raw, sf) {
  if (!Number.isInteger(sf) || sf < -10 || sf > 10) {
    throw new Error(`Scale factor ${sf} is out of range [-10, 10]`);
  }
  return raw * Math.pow(10, sf);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  applyScaleFactor,
  decodeRegisters,
  encodeFloat32le,
  encodeUint32le,
  isNotImplemented
});
//# sourceMappingURL=sunspec-decode.js.map
