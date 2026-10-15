import React from 'react';

import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Paper from '@mui/material/Paper';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { I18n, type IobTheme } from '@iobroker/gui-components';

// Shared, pure config validation reused by the adapter and this admin form.
// We import the SAME validateConfig / sunspec helpers from the adapter's src/lib
// rather than duplicate them. src-admin/tsconfig.json + Vite resolve the TS sources
// directly (Vite transpiles them on the fly), so no build step is needed for them.
import { validateConfig } from '../../../src/lib/config-validation';
import {
    getRegisterAddress,
    getInverterValueDefs,
    getMeterValueDefs,
    getBatteryValueDefs,
    getBatteryBase,
    getDeviceRegisterAddress,
} from '../../../src/lib/sunspec-map';
import type { SunSpecRegisterDef } from '../../../src/lib/sunspec-map';
import { STOREDGE_CONTROL_REGISTERS } from '../../../src/lib/storedge-control-map';
import type { StorEdgeControlRegisterDef } from '../../../src/lib/storedge-control-map';

/**
 * Format a Modbus register address as an uppercase, 4-digit, `0x`-prefixed hex string.
 * e.g. `0xe004 → "0xE004"`, `0xe010 → "0xE010"`.
 *
 * @param address Register address as a number.
 */
function formatAddress(address: number): string {
    return `0x${address.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Format a min/max range as `"min..max"`, rendering an unbounded max
 * (`Number.MAX_VALUE`) as the language-neutral infinity token `∞`.
 * e.g. `(0, 4) → "0..4"`, `(0, Number.MAX_VALUE) → "0..∞"`, `(0, 86400) → "0..86400"`.
 *
 * @param min Range lower bound.
 * @param max Range upper bound; `Number.MAX_VALUE` is treated as unbounded.
 */
function formatRange(min: number, max: number): string {
    const maxLabel = max === Number.MAX_VALUE ? '∞' : String(max);
    return `${min}..${maxLabel}`;
}

const styles: Record<string, React.CSSProperties> = {
    input: {
        marginTop: 0,
        marginRight: 20,
        minWidth: 200,
    },
    controlElement: {
        marginBottom: 5,
    },
    tableWrapper: {
        marginTop: 24,
        maxWidth: '100%',
    },
    scrollBox: {
        maxHeight: 360,
        overflow: 'auto',
    },
    accordionDetails: {
        padding: 0,
        display: 'block',
    },
};

interface SettingsProps {
    native: Record<string, any>;

    onChange: (attr: string, value: any) => void;

    theme?: IobTheme;
}

class Settings extends React.Component<SettingsProps> {
    /**
     * Coerce a raw native field value to a number for numeric config fields.
     *
     * @param value Raw value held in `native` for a numeric field.
     */
    private toNumber(value: any): number | undefined {
        if (value === '' || value === null || value === undefined) {
            return undefined;
        }
        const n = Number(value);
        return Number.isNaN(n) ? undefined : n;
    }

    /** Build the config object from native for validation. */
    private currentConfig(): Partial<ioBroker.AdapterConfig> {
        const { native } = this.props;
        return {
            host: native.host,
            port: this.toNumber(native.port),
            unitId: this.toNumber(native.unitId),
            pollInterval: this.toNumber(native.pollInterval),
        };
    }

    private errors(): ReturnType<typeof validateConfig>['errors'] {
        return validateConfig(this.currentConfig()).errors;
    }

    private renderNumberField(title: string, errorTitle: string, attr: string, hasError: boolean): React.JSX.Element {
        return (
            <TextField
                variant="standard"
                label={I18n.t(title)}
                style={{ ...styles.input, ...styles.controlElement }}
                value={this.props.native[attr] ?? ''}
                type="number"
                error={hasError}
                helperText={hasError ? I18n.t(errorTitle) : ''}
                onChange={e => {
                    const raw = e.target.value;
                    // Keep the value in native (retain-on-invalid handled by admin save layer);
                    // store as number when parseable so validation/bounds apply.
                    const num = raw === '' ? '' : Number(raw);
                    this.props.onChange(attr, num);
                }}
                margin="normal"
            />
        );
    }

    private renderHostField(hasError: boolean): React.JSX.Element {
        return (
            <TextField
                variant="standard"
                label={I18n.t('Host')}
                style={{ ...styles.input, ...styles.controlElement }}
                value={this.props.native.host ?? ''}
                type="text"
                error={hasError}
                helperText={hasError ? I18n.t('Invalid host') : ''}
                onChange={e => this.props.onChange('host', e.target.value)}
                margin="normal"
            />
        );
    }

    /**
     * Render the 5-column read-only value table for a single group of defs.
     *
     * @param defs SunSpec register definitions for this group (inverter, meter or battery).
     * @param addressOf Maps a def to the Register-column absolute address. Defaults to
     *   `getRegisterAddress` (inverter/meter). Battery rows pass a device-specific mapper
     *   so the column shows the real battery register address instead of falling through
     *   to INVERTER_BASE.
     */
    private renderTableFor(
        defs: SunSpecRegisterDef[],
        addressOf: (def: SunSpecRegisterDef) => number = getRegisterAddress,
    ): React.JSX.Element {
        return (
            <div style={styles.scrollBox}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>{I18n.t('Name')}</TableCell>
                            <TableCell>{I18n.t('Register')}</TableCell>
                            <TableCell>{I18n.t('Datatype')}</TableCell>
                            <TableCell>{I18n.t('Model')}</TableCell>
                            <TableCell>{I18n.t('Description')}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {defs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5}>{I18n.t('No SunSpec values available')}</TableCell>
                            </TableRow>
                        ) : (
                            defs.map(def => (
                                <TableRow key={def.name}>
                                    <TableCell>{def.name}</TableCell>
                                    <TableCell>{addressOf(def)}</TableCell>
                                    <TableCell>{def.datatype}</TableCell>
                                    <TableCell>{String(def.model)}</TableCell>
                                    <TableCell>{def.description ?? ''}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        );
    }

    private renderValueTable(): React.JSX.Element {
        const inverterDefs = getInverterValueDefs();
        const meterDefs = getMeterValueDefs();
        const batteryDefs = getBatteryValueDefs();

        return (
            <Paper style={styles.tableWrapper}>
                <Typography
                    variant="h6"
                    style={{ padding: 8 }}
                >
                    {I18n.t('SunSpec Values')}
                </Typography>

                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{`${I18n.t('Inverter values')} (${inverterDefs.length})`}</Typography>
                    </AccordionSummary>
                    <AccordionDetails style={styles.accordionDetails}>
                        {this.renderTableFor(inverterDefs)}
                    </AccordionDetails>
                </Accordion>

                <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{`${I18n.t('Meter values')} (${meterDefs.length})`}</Typography>
                    </AccordionSummary>
                    <AccordionDetails style={styles.accordionDetails}>
                        {this.renderTableFor(meterDefs)}
                    </AccordionDetails>
                </Accordion>

                <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>{`${I18n.t('Battery values')} (${batteryDefs.length})`}</Typography>
                    </AccordionSummary>
                    <AccordionDetails style={styles.accordionDetails}>
                        {/* Battery rows show the battery.1 absolute register address
                            (getBatteryBase(1) === 0xE100), representative of the per-device
                            battery.<n> channels, since getRegisterAddress does not handle
                            model 'battery'. */}
                        {this.renderTableFor(batteryDefs, def => getDeviceRegisterAddress(getBatteryBase(1), def))}
                    </AccordionDetails>
                </Accordion>
            </Paper>
        );
    }

    /**
     * Render the read-only StorEdge Control Block table, sourced from the static
     * `STOREDGE_CONTROL_REGISTERS` data. Display-only: no editable inputs and no
     * Modbus read/write/`sendTo` — this section consumes the control map read-only.
     */
    private renderStorEdgeTable(): React.JSX.Element {
        return (
            <Paper style={styles.tableWrapper}>
                <Typography
                    variant="h6"
                    style={{ padding: 8 }}
                >
                    {I18n.t('StorEdge Control Block')}
                </Typography>

                <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>
                            {`${I18n.t('StorEdge Control Block')} (${STOREDGE_CONTROL_REGISTERS.length})`}
                        </Typography>
                    </AccordionSummary>
                    <AccordionDetails style={styles.accordionDetails}>
                        <div style={styles.scrollBox}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{I18n.t('Name')}</TableCell>
                                        <TableCell>{I18n.t('Address')}</TableCell>
                                        <TableCell>{I18n.t('Encoding')}</TableCell>
                                        <TableCell>{I18n.t('Unit')}</TableCell>
                                        <TableCell>{I18n.t('Range')}</TableCell>
                                        <TableCell>{I18n.t('Function code')}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {STOREDGE_CONTROL_REGISTERS.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6}>
                                                {I18n.t('No StorEdge control registers available')}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        STOREDGE_CONTROL_REGISTERS.map((def: StorEdgeControlRegisterDef) => (
                                            <TableRow key={def.name}>
                                                <TableCell>{def.name}</TableCell>
                                                <TableCell>{formatAddress(def.address)}</TableCell>
                                                <TableCell>{def.kind}</TableCell>
                                                <TableCell>{def.unit ?? ''}</TableCell>
                                                <TableCell>{formatRange(def.min, def.max)}</TableCell>
                                                <TableCell>{def.fc}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </AccordionDetails>
                </Accordion>
            </Paper>
        );
    }

    render(): React.JSX.Element {
        const errors = this.errors();

        return (
            <form style={{ padding: 16 }}>
                <div>
                    {this.renderHostField(!!errors.host)}
                    {this.renderNumberField('Port', 'Invalid port', 'port', !!errors.port)}
                    {this.renderNumberField('Unit ID', 'Invalid unit ID', 'unitId', !!errors.unitId)}
                    {this.renderNumberField(
                        'Polling interval (s)',
                        'Invalid polling interval',
                        'pollInterval',
                        !!errors.pollInterval,
                    )}
                </div>

                {this.renderValueTable()}
                {this.renderStorEdgeTable()}
            </form>
        );
    }
}

export default Settings;
