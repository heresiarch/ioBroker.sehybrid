import React from 'react';

import TextField from '@mui/material/TextField';

import { I18n, type IobTheme } from '@iobroker/gui-components';

// Shared, pure config validation reused by the adapter and this admin form.
// We import the SAME validateConfig from the adapter's src/lib rather than
// duplicate it. src-admin/tsconfig.json + Vite resolve the TS sources directly
// (Vite transpiles them on the fly), so no build step is needed for them.
import { validateConfig } from '../../../src/lib/config-validation';

const styles: Record<string, React.CSSProperties> = {
    input: {
        marginTop: 0,
        marginRight: 20,
        minWidth: 200,
    },
    controlElement: {
        marginBottom: 5,
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
            </form>
        );
    }
}

export default Settings;
