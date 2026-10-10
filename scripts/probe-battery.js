#!/usr/bin/env node
/* eslint-disable */
// Standalone Modbus probe for diagnosing battery detection.
// Reads the SolarEdge battery presence registers and identity block directly,
// mirroring what SunSpecReader.detectBatteries evaluates.
//
// Modes (all READ-ONLY):
//   node scripts/probe-battery.js [host] [port] [unitId]         battery detection probe (default)
//   node scripts/probe-battery.js [host] [port] [unitId] seg     segmented battery-slot read reproduction
//   node scripts/probe-battery.js [host] [port] [unitId] ctrl    Global StorEdge Control Block read

const ModbusRTU = require('modbus-serial');

const host = process.argv[2] || '192.168.178.4';
const port = parseInt(process.argv[3] || '1502', 10);
const unitId = parseInt(process.argv[4] || '1', 10);

const BATTERY_TEMPLATE_BASE = 0xe100;
const BATTERY_DID_BASE = 0xe140;
const OFFSETS = [0, 256]; // slot 1, slot 2

function hex(n) {
    return '0x' + (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

async function readSafe(client, addr, len, label) {
    try {
        const res = await client.readHoldingRegisters(addr, len);
        console.log(`  OK   ${label} @ ${hex(addr)} (${addr}) len ${len}: [${res.data.map(hex).join(', ')}]`);
        return res.data;
    } catch (e) {
        console.log(`  FAIL ${label} @ ${hex(addr)} (${addr}) len ${len}: ${e.message || e}`);
        return null;
    }
}

async function main() {
    const client = new ModbusRTU();
    client.setTimeout(10000);
    console.log(`Connecting to ${host}:${port} unit ${unitId} ...`);
    await client.connectTCP(host, { port });
    client.setID(unitId);
    console.log('Connected.\n');

    for (let slot = 1; slot <= 2; slot++) {
        const off = OFFSETS[slot - 1];
        const didAddr = BATTERY_DID_BASE + off;
        const baseAddr = BATTERY_TEMPLATE_BASE + off;
        console.log(`=== Battery slot ${slot} ===`);

        // Presence probe exactly as detectBatteries does: 1 register at DID base.
        const did = await readSafe(client, didAddr, 1, 'presence/c_deviceaddress');
        if (did) {
            const probe = did[0] & 0xffff;
            const absent = probe === 0xffff || probe === 255 || probe === 0;
            console.log(`       -> probe value = ${probe} (${hex(probe)}) => ${absent ? 'ABSENT (skipped)' : 'PRESENT'}`);
        }

        // Extra context: identity string base + a couple more block words.
        await readSafe(client, baseAddr, 4, 'block base (identity)');
        await readSafe(client, baseAddr + 0x42, 2, 'batch2 start');
        console.log('');
    }

    await client.close(() => {});
    process.exit(0);
}

const MODE = process.argv[5];

if (MODE !== 'seg' && MODE !== 'ctrl') {
    main().catch(e => {
        console.error('Probe failed:', e.message || e);
        process.exit(1);
    });
}

// --- segmented read reproduction (call with `seg` as 5th arg) ---------------
async function probeSegments() {
    const ModbusRTU2 = require('modbus-serial');
    const client = new ModbusRTU2();
    client.setTimeout(10000);
    await client.connectTCP(host, { port });
    client.setID(unitId);
    const base = BATTERY_TEMPLATE_BASE; // slot 1
    const segments = [
        { offset: 0x00, length: 66 },
        { offset: 0x42, length: 82 },
    ];
    console.log('\n=== Reproducing readBatterySlot segmented reads (slot 1) ===');
    for (const s of segments) {
        const addr = base + s.offset;
        try {
            const res = await client.readHoldingRegisters(addr, s.length);
            console.log(`  OK   segment @ ${hex(addr)} len ${s.length}: got ${res.data.length} words`);
        } catch (e) {
            console.log(`  FAIL segment @ ${hex(addr)} len ${s.length}: ${e.message || e}`);
        }
    }
    await client.close(() => {});
}

if (MODE === 'seg') {
    probeSegments().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

// --- Global StorEdge Control Block read (call with `ctrl` as 5th arg) --------
// READ-ONLY. Reads the nine manufacturer-documented control registers at base
// 0xE004 and decodes them exactly as src/lib/storedge-control-map.ts describes
// (uint16, uint32le, float32le). No writes are performed.
const STOREDGE_CONTROL_BASE = 0xe004;
const STOREDGE_CONTROL_SPAN = 0xe011 - 0xe004 + 1; // through high word of 0xE010 = 14 regs
const STOREDGE_CONTROL_REGISTERS = [
    { name: 'storageControlMode',                address: 0xe004, kind: 'uint16',  length: 1, unit: '',    states: { 0: 'Disabled', 1: 'Maximize Self Consumption', 2: 'Time of Use', 3: 'Backup Only', 4: 'Remote Control' } },
    { name: 'storageAcChargePolicy',             address: 0xe005, kind: 'uint16',  length: 1, unit: '',    states: { 0: 'Disable', 1: 'Always Allowed', 2: 'Fixed Energy Limit', 3: 'Percent of Production' } },
    { name: 'storageAcChargeLimit',              address: 0xe006, kind: 'float32', length: 2, unit: 'kWh' },
    { name: 'storageBackupReservedSetting',      address: 0xe008, kind: 'float32', length: 2, unit: '%' },
    { name: 'storageChargeDischargeDefaultMode', address: 0xe00a, kind: 'uint16',  length: 1, unit: '',    states: { 0: 'Off', 1: 'Charge Excess PV Power Only', 2: 'Charge from PV First', 3: 'Charge from PV + AC', 4: 'Maximize Export', 5: 'Discharge to Meet Consumption', 7: 'Maximize Self Consumption' } },
    { name: 'remoteControlCommandTimeout',       address: 0xe00b, kind: 'uint32',  length: 2, unit: 's' },
    { name: 'remoteControlCommandMode',          address: 0xe00d, kind: 'uint16',  length: 1, unit: '',    states: { 0: 'Off', 1: 'Charge Excess PV Power Only', 2: 'Charge from PV First', 3: 'Charge from PV + AC', 4: 'Maximize Export', 5: 'Discharge to Meet Consumption', 7: 'Maximize Self Consumption' } },
    { name: 'remoteControlChargeLimit',          address: 0xe00e, kind: 'float32', length: 2, unit: 'W' },
    { name: 'remoteControlDischargeLimit',       address: 0xe010, kind: 'float32', length: 2, unit: 'W' },
];

// Little-endian word order: low word first, bytes big-endian within each word.
function decodeStorEdge(words, kind) {
    if (kind === 'uint16') {
        return words[0] & 0xffff;
    }
    const low = words[0] & 0xffff;
    const high = words[1] & 0xffff;
    const buf = Buffer.alloc(4);
    buf.writeUInt16BE(high, 0);
    buf.writeUInt16BE(low, 2);
    if (kind === 'uint32') {
        return buf.readUInt32BE(0);
    }
    return buf.readFloatBE(0);
}

async function probeStorEdgeControl() {
    const ModbusRTU2 = require('modbus-serial');
    const client = new ModbusRTU2();
    client.setTimeout(10000);
    console.log(`[READ-ONLY] Connecting to ${host}:${port} unit ${unitId} ...`);
    await client.connectTCP(host, { port });
    client.setID(unitId);
    console.log(`Connected. Reading Global StorEdge Control Block @ ${hex(STOREDGE_CONTROL_BASE)} (${STOREDGE_CONTROL_BASE}), ${STOREDGE_CONTROL_SPAN} regs.\n`);

    const res = await client.readHoldingRegisters(STOREDGE_CONTROL_BASE, STOREDGE_CONTROL_SPAN);
    const words = res.data;
    console.log(`Raw: [${words.map(hex).join(', ')}]\n`);

    for (const def of STOREDGE_CONTROL_REGISTERS) {
        const offset = def.address - STOREDGE_CONTROL_BASE;
        const slice = words.slice(offset, offset + def.length);
        const value = decodeStorEdge(slice, def.kind);
        let display = value;
        if (def.states && Object.prototype.hasOwnProperty.call(def.states, value)) {
            display = `${value} (${def.states[value]})`;
        } else if (def.kind === 'float32') {
            display = Number(value.toFixed(3));
        }
        const unit = def.unit ? ` ${def.unit}` : '';
        console.log(
            `${def.name.padEnd(35)} ${hex(def.address)} ${def.kind.padEnd(7)} ` +
            `raw=[${slice.map(hex).join(', ')}] => ${display}${unit}`
        );
    }

    await client.close(() => {});
}

if (MODE === 'ctrl') {
    probeStorEdgeControl().then(() => process.exit(0)).catch(e => { console.error('Probe failed:', e.message || e); process.exit(1); });
}
