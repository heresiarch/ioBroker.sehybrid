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
var sunspec_map_exports = {};
__export(sunspec_map_exports, {
  BATTERY_DID_BASE: () => BATTERY_DID_BASE,
  BATTERY_MAP: () => BATTERY_MAP,
  BATTERY_READ_SEGMENTS: () => BATTERY_READ_SEGMENTS,
  BATTERY_REGISTER_OFFSETS: () => BATTERY_REGISTER_OFFSETS,
  BATTERY_TEMPLATE_BASE: () => BATTERY_TEMPLATE_BASE,
  COMMON_BASE: () => COMMON_BASE,
  INVERTER_BASE: () => INVERTER_BASE,
  METER_BASE: () => METER_BASE,
  METER_DID_BASE: () => METER_DID_BASE,
  METER_REGISTER_OFFSETS: () => METER_REGISTER_OFFSETS,
  SUNSPEC_MAP: () => SUNSPEC_MAP,
  getBatteryBase: () => getBatteryBase,
  getBatteryDidAddress: () => getBatteryDidAddress,
  getBatteryPresenceAddress: () => getBatteryPresenceAddress,
  getBatteryValueDefs: () => getBatteryValueDefs,
  getDeviceRegisterAddress: () => getDeviceRegisterAddress,
  getInverterValueDefs: () => getInverterValueDefs,
  getMeterBase: () => getMeterBase,
  getMeterDidAddress: () => getMeterDidAddress,
  getMeterValueDefs: () => getMeterValueDefs,
  getRegisterAddress: () => getRegisterAddress,
  getValueDefs: () => getValueDefs
});
module.exports = __toCommonJS(sunspec_map_exports);
const COMMON_BASE = 4e4;
const INVERTER_BASE = 40069;
const METER_BASE = 40121;
const METER_DID_BASE = 40188;
const METER_REGISTER_OFFSETS = [0, 174, 348];
const BATTERY_TEMPLATE_BASE = 57600;
const BATTERY_DID_BASE = 57664;
const BATTERY_REGISTER_OFFSETS = [0, 256];
const SUNSPEC_MAP = [
  // --- Common block (base 40000): identity / detection (Req 3.3) ---------------
  // C_SunSpec_ID must equal 0x53756e53 ("SunS"). These are not measurement states.
  {
    name: "C_SunSpec_ID",
    model: "common",
    offset: 4e4 - COMMON_BASE,
    length: 2,
    datatype: "uint32",
    role: "info",
    iobType: "number"
  },
  {
    name: "C_SunSpec_DID",
    model: "common",
    offset: 40002 - COMMON_BASE,
    length: 1,
    datatype: "uint16",
    role: "info",
    iobType: "number"
  },
  {
    name: "C_SunSpec_Length",
    model: "common",
    offset: 40003 - COMMON_BASE,
    length: 1,
    datatype: "uint16",
    role: "info",
    iobType: "number"
  },
  {
    name: "C_Manufacturer",
    model: "common",
    offset: 40004 - COMMON_BASE,
    length: 16,
    datatype: "string",
    role: "info",
    iobType: "string"
  },
  {
    name: "C_Model",
    model: "common",
    offset: 40020 - COMMON_BASE,
    length: 16,
    datatype: "string",
    role: "info",
    iobType: "string"
  },
  {
    name: "C_DeviceAddress",
    model: "common",
    offset: 40068 - COMMON_BASE,
    length: 1,
    datatype: "uint16",
    role: "info",
    iobType: "number"
  },
  // --- Inverter block (models 101/102/103, base 40069) -------------------------
  // Tagged with canonical model 101 (see NOTE above). offset = addr - INVERTER_BASE.
  {
    name: "acCurrent",
    model: 101,
    offset: 40071 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "I_AC_Current \u2014 AC Total Current value"
  },
  {
    name: "acCurrentA",
    model: 101,
    offset: 40072 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "I_AC_CurrentA \u2014 AC Phase A Current value"
  },
  {
    name: "acCurrentB",
    model: 101,
    offset: 40073 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "I_AC_CurrentB \u2014 AC Phase B Current value"
  },
  {
    name: "acCurrentC",
    model: 101,
    offset: 40074 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "I_AC_CurrentC \u2014 AC Phase C Current value"
  },
  {
    name: "acCurrentSF",
    model: 101,
    offset: 40075 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "acVoltageAB",
    model: 101,
    offset: 40076 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "I_AC_VoltageAB \u2014 AC Voltage Phase AB value"
  },
  {
    name: "acVoltageBC",
    model: 101,
    offset: 40077 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "I_AC_VoltageBC \u2014 AC Voltage Phase BC value"
  },
  {
    name: "acVoltageCA",
    model: 101,
    offset: 40078 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "I_AC_VoltageCA \u2014 AC Voltage Phase CA value"
  },
  {
    name: "acVoltageAN",
    model: 101,
    offset: 40079 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "I_AC_VoltageAN \u2014 AC Voltage Phase A to N value"
  },
  {
    name: "acVoltageBN",
    model: 101,
    offset: 40080 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "I_AC_VoltageBN \u2014 AC Voltage Phase B to N value"
  },
  {
    name: "acVoltageCN",
    model: 101,
    offset: 40081 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "I_AC_VoltageCN \u2014 AC Voltage Phase C to N value"
  },
  {
    name: "acVoltageSF",
    model: 101,
    offset: 40082 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "acPower",
    model: 101,
    offset: 40083 - INVERTER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "acPowerSF",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "I_AC_Power \u2014 AC Power value"
  },
  {
    name: "acPowerSF",
    model: 101,
    offset: 40084 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "acFrequency",
    model: 101,
    offset: 40085 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "acFrequencySF",
    unit: "Hz",
    role: "frequency",
    iobType: "number",
    description: "I_AC_Frequency \u2014 AC Frequency value"
  },
  {
    name: "acFrequencySF",
    model: 101,
    offset: 40086 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "acVA",
    model: 101,
    offset: 40087 - INVERTER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "acVASF",
    unit: "VA",
    role: "power.apparent",
    iobType: "number",
    description: "I_AC_VA \u2014 Apparent Power"
  },
  {
    name: "acVASF",
    model: 101,
    offset: 40088 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "acVAR",
    model: 101,
    offset: 40089 - INVERTER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "acVARSF",
    unit: "var",
    role: "power.reactive",
    iobType: "number",
    description: "I_AC_VAR \u2014 Reactive Power"
  },
  {
    name: "acVARSF",
    model: 101,
    offset: 40090 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "acPF",
    model: 101,
    offset: 40091 - INVERTER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "acPFSF",
    unit: "%",
    role: "powerFactor",
    iobType: "number",
    description: "I_AC_PF \u2014 Power Factor"
  },
  {
    name: "acPFSF",
    model: 101,
    offset: 40092 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "acEnergyWh",
    model: 101,
    offset: 40093 - INVERTER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "acEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "I_AC_Energy_WH \u2014 AC Lifetime Energy production"
  },
  {
    name: "acEnergyWhSF",
    model: 101,
    offset: 40095 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "dcCurrent",
    model: 101,
    offset: 40096 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "dcCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "I_DC_Current \u2014 DC Current value"
  },
  {
    name: "dcCurrentSF",
    model: 101,
    offset: 40097 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "dcVoltage",
    model: 101,
    offset: 40098 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    scaleFactorRef: "dcVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "I_DC_Voltage \u2014 DC Voltage value"
  },
  {
    name: "dcVoltageSF",
    model: 101,
    offset: 40099 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "dcPower",
    model: 101,
    offset: 40100 - INVERTER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "dcPowerSF",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "I_DC_Power \u2014 DC Power value"
  },
  {
    name: "dcPowerSF",
    model: 101,
    offset: 40101 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "tempSink",
    model: 101,
    offset: 40103 - INVERTER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "tempSF",
    unit: "\xB0C",
    role: "temperature",
    iobType: "number",
    description: "I_Temp_Sink \u2014 Heat Sink Temperature"
  },
  {
    name: "tempSF",
    model: 101,
    offset: 40106 - INVERTER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "status",
    model: 101,
    offset: 40107 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    role: "status",
    iobType: "number",
    description: "I_Status \u2014 Operating State"
  },
  {
    name: "statusVendor",
    model: 101,
    offset: 40108 - INVERTER_BASE,
    length: 1,
    datatype: "uint16",
    role: "status",
    iobType: "number",
    description: "I_Status_Vendor \u2014 Vendor-defined operating state and error codes"
  },
  // --- Meter block (models 201/202/203/204, base 40121) ------------------------
  // Tagged with canonical model 201 (see NOTE above). offset = addr - METER_BASE.
  // Addresses (base-0) from the technical note "Meter 1" MODBUS mapping:
  //   M_AC_Current 40190, M_AC_Current_SF 40194, M_AC_Voltage_LN 40195,
  //   M_AC_Voltage_SF 40203, M_AC_Freq 40204, M_AC_Freq_SF 40205,
  //   M_AC_Power 40206, M_AC_Power_SF 40210, M_Exported 40226 (uint32/acc32),
  //   M_Imported 40234 (uint32/acc32), M_Energy_W_SF 40242.
  {
    name: "mCurrent",
    model: 201,
    offset: 40190 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "M_AC_Current \u2014 AC Current (sum of active phases)"
  },
  {
    name: "mCurrentA",
    model: 201,
    offset: 40191 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "M_AC_Current_A \u2014 Phase A AC Current"
  },
  {
    name: "mCurrentB",
    model: 201,
    offset: 40192 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "M_AC_Current_B \u2014 Phase B AC Current"
  },
  {
    name: "mCurrentC",
    model: 201,
    offset: 40193 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mCurrentSF",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "M_AC_Current_C \u2014 Phase C AC Current"
  },
  {
    name: "mCurrentSF",
    model: 201,
    offset: 40194 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "mVoltageLN",
    model: 201,
    offset: 40195 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_LN \u2014 Line to Neutral AC Voltage"
  },
  {
    name: "mVoltageAN",
    model: 201,
    offset: 40196 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_AN \u2014 Phase A to Neutral AC Voltage"
  },
  {
    name: "mVoltageBN",
    model: 201,
    offset: 40197 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_BN \u2014 Phase B to Neutral AC Voltage"
  },
  {
    name: "mVoltageCN",
    model: 201,
    offset: 40198 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_CN \u2014 Phase C to Neutral AC Voltage"
  },
  {
    name: "mVoltageLL",
    model: 201,
    offset: 40199 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_LL \u2014 Line to Line AC Voltage"
  },
  {
    name: "mVoltageAB",
    model: 201,
    offset: 40200 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_AB \u2014 Phase A to Phase B AC Voltage"
  },
  {
    name: "mVoltageBC",
    model: 201,
    offset: 40201 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_BC \u2014 Phase B to Phase C AC Voltage"
  },
  {
    name: "mVoltageCA",
    model: 201,
    offset: 40202 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVoltageSF",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "M_AC_Voltage_CA \u2014 Phase C to Phase A AC Voltage"
  },
  {
    name: "mVoltageSF",
    model: 201,
    offset: 40203 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "mFrequency",
    model: 201,
    offset: 40204 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mFrequencySF",
    unit: "Hz",
    role: "frequency",
    iobType: "number",
    description: "M_AC_Freq \u2014 AC Frequency"
  },
  {
    name: "mFrequencySF",
    model: 201,
    offset: 40205 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "mPower",
    model: 201,
    offset: 40206 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPowerSF",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "M_AC_Power \u2014 Total Real Power (sum of active phases)"
  },
  {
    name: "mPowerA",
    model: 201,
    offset: 40207 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPowerSF",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "M_AC_Power_A \u2014 Phase A AC Real Power"
  },
  {
    name: "mPowerB",
    model: 201,
    offset: 40208 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPowerSF",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "M_AC_Power_B \u2014 Phase B AC Real Power"
  },
  {
    name: "mPowerC",
    model: 201,
    offset: 40209 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPowerSF",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "M_AC_Power_C \u2014 Phase C AC Real Power"
  },
  {
    name: "mPowerSF",
    model: 201,
    offset: 40210 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "mVA",
    model: 201,
    offset: 40211 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVASF",
    unit: "VA",
    role: "power.apparent",
    iobType: "number",
    description: "M_AC_VA \u2014 Total AC Apparent Power (sum of active phases)"
  },
  {
    name: "mVAA",
    model: 201,
    offset: 40212 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVASF",
    unit: "VA",
    role: "power.apparent",
    iobType: "number",
    description: "M_AC_VA_A \u2014 Phase A AC Apparent Power"
  },
  {
    name: "mVAB",
    model: 201,
    offset: 40213 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVASF",
    unit: "VA",
    role: "power.apparent",
    iobType: "number",
    description: "M_AC_VA_B \u2014 Phase B AC Apparent Power"
  },
  {
    name: "mVAC",
    model: 201,
    offset: 40214 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVASF",
    unit: "VA",
    role: "power.apparent",
    iobType: "number",
    description: "M_AC_VA_C \u2014 Phase C AC Apparent Power"
  },
  {
    name: "mVASF",
    model: 201,
    offset: 40215 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "mVAR",
    model: 201,
    offset: 40216 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVARSF",
    unit: "var",
    role: "power.reactive",
    iobType: "number",
    description: "M_AC_VAR \u2014 Total AC Reactive Power (sum of active phases)"
  },
  {
    name: "mVARA",
    model: 201,
    offset: 40217 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVARSF",
    unit: "var",
    role: "power.reactive",
    iobType: "number",
    description: "M_AC_VAR_A \u2014 Phase A AC Reactive Power"
  },
  {
    name: "mVARB",
    model: 201,
    offset: 40218 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVARSF",
    unit: "var",
    role: "power.reactive",
    iobType: "number",
    description: "M_AC_VAR_B \u2014 Phase B AC Reactive Power"
  },
  {
    name: "mVARC",
    model: 201,
    offset: 40219 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mVARSF",
    unit: "var",
    role: "power.reactive",
    iobType: "number",
    description: "M_AC_VAR_C \u2014 Phase C AC Reactive Power"
  },
  {
    name: "mVARSF",
    model: 201,
    offset: 40220 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "mPF",
    model: 201,
    offset: 40221 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPFSF",
    unit: "%",
    role: "powerFactor",
    iobType: "number",
    description: "M_AC_PF \u2014 Average Power Factor"
  },
  {
    name: "mPFA",
    model: 201,
    offset: 40222 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPFSF",
    unit: "%",
    role: "powerFactor",
    iobType: "number",
    description: "M_AC_PF_A \u2014 Phase A Power Factor"
  },
  {
    name: "mPFB",
    model: 201,
    offset: 40223 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPFSF",
    unit: "%",
    role: "powerFactor",
    iobType: "number",
    description: "M_AC_PF_B \u2014 Phase B Power Factor"
  },
  {
    name: "mPFC",
    model: 201,
    offset: 40224 - METER_BASE,
    length: 1,
    datatype: "int16",
    scaleFactorRef: "mPFSF",
    unit: "%",
    role: "powerFactor",
    iobType: "number",
    description: "M_AC_PF_C \u2014 Phase C Power Factor"
  },
  {
    name: "mPFSF",
    model: 201,
    offset: 40225 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  },
  {
    name: "mExportedWh",
    model: 201,
    offset: 40226 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Exported \u2014 Total Exported Real Energy"
  },
  {
    name: "mExportedWhA",
    model: 201,
    offset: 40228 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Exported_A \u2014 Phase A Exported Real Energy"
  },
  {
    name: "mExportedWhB",
    model: 201,
    offset: 40230 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Exported_B \u2014 Phase B Exported Real Energy"
  },
  {
    name: "mExportedWhC",
    model: 201,
    offset: 40232 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Exported_C \u2014 Phase C Exported Real Energy"
  },
  {
    name: "mImportedWh",
    model: 201,
    offset: 40234 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Imported \u2014 Total Imported Real Energy"
  },
  {
    name: "mImportedWhA",
    model: 201,
    offset: 40236 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Imported_A \u2014 Phase A Imported Real Energy"
  },
  {
    name: "mImportedWhB",
    model: 201,
    offset: 40238 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Imported_B \u2014 Phase B Imported Real Energy"
  },
  {
    name: "mImportedWhC",
    model: 201,
    offset: 40240 - METER_BASE,
    length: 2,
    datatype: "acc32",
    scaleFactorRef: "mEnergyWhSF",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "M_Imported_C \u2014 Phase C Imported Real Energy"
  },
  {
    name: "mEnergyWhSF",
    model: 201,
    offset: 40242 - METER_BASE,
    length: 1,
    datatype: "sunssf",
    role: "info",
    iobType: "number"
  }
];
function getRegisterAddress(def) {
  if (def.model === "common") {
    return COMMON_BASE + def.offset;
  }
  if (def.model === 201 || def.model === 202 || def.model === 203 || def.model === 204) {
    return METER_BASE + def.offset;
  }
  return INVERTER_BASE + def.offset;
}
const INVERTER_MODELS = /* @__PURE__ */ new Set([101, 102, 103]);
const METER_MODELS = /* @__PURE__ */ new Set([201, 202, 203, 204]);
function getValueDefs(map = SUNSPEC_MAP) {
  return map.filter((def) => def.role !== "info");
}
function getInverterValueDefs(map = SUNSPEC_MAP) {
  return getValueDefs(map).filter((def) => INVERTER_MODELS.has(def.model));
}
function getMeterValueDefs(map = SUNSPEC_MAP) {
  return getValueDefs(map).filter((def) => METER_MODELS.has(def.model));
}
const BATTERY_MAP = [
  {
    name: "c_manufacturer",
    model: "battery",
    offset: 57600 - BATTERY_TEMPLATE_BASE,
    length: 16,
    datatype: "string",
    role: "info",
    iobType: "string",
    description: "Battery C_Manufacturer \u2014 Manufacturer"
  },
  {
    name: "c_model",
    model: "battery",
    offset: 57616 - BATTERY_TEMPLATE_BASE,
    length: 16,
    datatype: "string",
    role: "info",
    iobType: "string",
    description: "Battery C_Model \u2014 Model"
  },
  {
    name: "c_version",
    model: "battery",
    offset: 57632 - BATTERY_TEMPLATE_BASE,
    length: 16,
    datatype: "string",
    role: "info",
    iobType: "string",
    description: "Battery C_Version \u2014 Firmware Version"
  },
  {
    name: "c_serialnumber",
    model: "battery",
    offset: 57648 - BATTERY_TEMPLATE_BASE,
    length: 16,
    datatype: "string",
    role: "info",
    iobType: "string",
    description: "Battery C_SerialNumber \u2014 Serial Number"
  },
  {
    name: "c_deviceaddress",
    model: "battery",
    offset: 57664 - BATTERY_TEMPLATE_BASE,
    length: 1,
    datatype: "uint16",
    role: "info",
    iobType: "number",
    description: "Battery C_DeviceAddress \u2014 Modbus ID"
  },
  {
    name: "c_sunspec_did",
    model: "battery",
    offset: 57665 - BATTERY_TEMPLATE_BASE,
    length: 1,
    datatype: "uint16",
    role: "info",
    iobType: "number",
    description: "Battery C_SunSpec_DID \u2014 SunSpec DID"
  },
  {
    name: "ratedEnergy",
    model: "battery",
    offset: 57666 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "Battery Rated_Energy \u2014 Rated Energy"
  },
  {
    name: "maxChargeContinuousPower",
    model: "battery",
    offset: 57668 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "Battery Max_Charge_Continuous_Power \u2014 Maximum Charge Continuous Power"
  },
  {
    name: "maxDischargeContinuousPower",
    model: "battery",
    offset: 57670 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "Battery Max_Discharge_Continuous_Power \u2014 Maximum Discharge Continuous Power"
  },
  {
    name: "maxChargePeakPower",
    model: "battery",
    offset: 57672 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "Battery Max_Charge_Peak_Power \u2014 Maximum Charge Peak Power"
  },
  {
    name: "maxDischargePeakPower",
    model: "battery",
    offset: 57674 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "Battery Max_Discharge_Peak_Power \u2014 Maximum Discharge Peak Power"
  },
  {
    name: "averageTemperature",
    model: "battery",
    offset: 57708 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "\xB0C",
    role: "temperature",
    iobType: "number",
    description: "Battery Average_Temperature \u2014 Average Temperature"
  },
  {
    name: "maximumTemperature",
    model: "battery",
    offset: 57710 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "\xB0C",
    role: "temperature",
    iobType: "number",
    description: "Battery Maximum_Temperature \u2014 Maximum Temperature"
  },
  {
    name: "instantaneousVoltage",
    model: "battery",
    offset: 57712 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "V",
    role: "voltage",
    iobType: "number",
    description: "Battery Instantaneous_Voltage \u2014 Instantaneous Voltage"
  },
  {
    name: "instantaneousCurrent",
    model: "battery",
    offset: 57714 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "A",
    role: "current",
    iobType: "number",
    description: "Battery Instantaneous_Current \u2014 Instantaneous Current"
  },
  {
    name: "instantaneousPower",
    model: "battery",
    offset: 57716 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "W",
    role: "power",
    iobType: "number",
    description: "Battery Instantaneous_Power \u2014 Instantaneous Power"
  },
  {
    name: "lifetimeExportEnergy",
    model: "battery",
    offset: 57718 - BATTERY_TEMPLATE_BASE,
    length: 4,
    datatype: "uint64le",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "Battery Lifetime_Export_Energy \u2014 Total Exported Energy"
  },
  {
    name: "lifetimeImportEnergy",
    model: "battery",
    offset: 57722 - BATTERY_TEMPLATE_BASE,
    length: 4,
    datatype: "uint64le",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "Battery Lifetime_Import_Energy \u2014 Total Imported Energy"
  },
  {
    name: "maximumEnergy",
    model: "battery",
    offset: 57726 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "Battery Maximum_Energy \u2014 Maximum Energy"
  },
  {
    name: "availableEnergy",
    model: "battery",
    offset: 57728 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "Wh",
    role: "energy",
    iobType: "number",
    description: "Battery Available_Energy \u2014 Available Energy"
  },
  {
    name: "soh",
    model: "battery",
    offset: 57730 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "%",
    role: "percent",
    iobType: "number",
    description: "Battery SOH \u2014 State of Health"
  },
  {
    name: "soe",
    model: "battery",
    offset: 57732 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "float32le",
    unit: "%",
    role: "percent",
    iobType: "number",
    description: "Battery SOE \u2014 State of Energy"
  },
  {
    name: "status",
    model: "battery",
    offset: 57734 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "uint32le",
    role: "status",
    iobType: "number",
    description: "Battery Status \u2014 Status (0 Off,1 Standby,2 Init,3 Charge,4 Discharge,5 Fault,6 Idle)"
  },
  {
    name: "statusInternal",
    model: "battery",
    offset: 57736 - BATTERY_TEMPLATE_BASE,
    length: 2,
    datatype: "uint32le",
    role: "status",
    iobType: "number",
    description: "Battery Status_Internal \u2014 Internal Status"
  },
  {
    name: "eventLog",
    model: "battery",
    offset: 57738 - BATTERY_TEMPLATE_BASE,
    length: 1,
    datatype: "uint16",
    role: "info",
    iobType: "number",
    description: "Battery Event_Log \u2014 Event Log"
  },
  {
    name: "eventLogInternal",
    model: "battery",
    offset: 57746 - BATTERY_TEMPLATE_BASE,
    length: 1,
    datatype: "uint16",
    role: "info",
    iobType: "number",
    description: "Battery Event_Log_Internal \u2014 Internal Event Log"
  }
];
function getDeviceRegisterAddress(baseAddress, def) {
  return baseAddress + def.offset;
}
function getMeterBase(slot) {
  return METER_BASE + METER_REGISTER_OFFSETS[slot - 1];
}
function getMeterDidAddress(slot) {
  return METER_DID_BASE + METER_REGISTER_OFFSETS[slot - 1];
}
function getBatteryBase(slot) {
  return BATTERY_TEMPLATE_BASE + BATTERY_REGISTER_OFFSETS[slot - 1];
}
function getBatteryDidAddress(slot) {
  return BATTERY_DID_BASE + BATTERY_REGISTER_OFFSETS[slot - 1];
}
function getBatteryValueDefs(map = BATTERY_MAP) {
  return map.filter((def) => def.role !== "info");
}
const BATTERY_READ_SEGMENTS = [
  { offset: 0, length: 66 },
  // 0xE100..0xE141
  { offset: 66, length: 82 }
  // 0xE142..0xE193 (spans the 0xE14B..0xE16B gap)
];
function getBatteryPresenceAddress(slot) {
  return BATTERY_DID_BASE + BATTERY_REGISTER_OFFSETS[slot - 1];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BATTERY_DID_BASE,
  BATTERY_MAP,
  BATTERY_READ_SEGMENTS,
  BATTERY_REGISTER_OFFSETS,
  BATTERY_TEMPLATE_BASE,
  COMMON_BASE,
  INVERTER_BASE,
  METER_BASE,
  METER_DID_BASE,
  METER_REGISTER_OFFSETS,
  SUNSPEC_MAP,
  getBatteryBase,
  getBatteryDidAddress,
  getBatteryPresenceAddress,
  getBatteryValueDefs,
  getDeviceRegisterAddress,
  getInverterValueDefs,
  getMeterBase,
  getMeterDidAddress,
  getMeterValueDefs,
  getRegisterAddress,
  getValueDefs
});
//# sourceMappingURL=sunspec-map.js.map
