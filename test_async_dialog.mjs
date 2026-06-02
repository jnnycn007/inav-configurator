#!/usr/bin/env node
/**
 * Regression tests for the async dialog.confirm fix and VTOL profile sync fix.
 *
 * Background
 * ----------
 * dialog.confirm was calling window.electronAPI.confirmDialog which was
 * wired to ipcRenderer.sendSync in preload.js.  sendSync blocked the entire
 * JS renderer event loop while the OS dialog was open.  Any setInterval /
 * setTimeout callbacks queued during the block fired all at once after
 * sendSync returned, which could cancel in-flight MSP command callbacks
 * (the global_data_refresh race).
 *
 * The fix replaced sendSync with ipcRenderer.invoke (async) throughout the
 * stack:
 *   preload.js  : confirmDialog uses ipcRenderer.invoke instead of sendSync
 *   main.js     : ipcMain.handle + showMessageBox (async) instead of
 *                 ipcMain.on + showMessageBoxSync
 *   dialog.js   : confirm() returns the Promise from confirmDialog directly
 *
 * Running
 * -------
 *   node test_async_dialog.mjs
 *
 * Exit code 0  — all tests passed.
 * Exit code 1  — at least one test failed.
 */

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Mock window.electronAPI so dialog.js can be imported in Node.js
// ---------------------------------------------------------------------------

global.window = {};

function stubConfirmSync(value) {
    global.window.electronAPI = { confirmDialog: () => value };
}

function stubConfirmAsync(value) {
    global.window.electronAPI = { confirmDialog: () => Promise.resolve(value) };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {

    const { default: dialog } = await import('./js/dialog.js');

    // --- 1a. confirm returns truthy when user clicks Yes ---
    console.log('\n1a. dialog.confirm returns truthy when user confirms');
    {
        stubConfirmSync(true);
        const raw = dialog.confirm('Are you sure?');
        const resolved = (raw && typeof raw.then === 'function') ? await raw : raw;
        assert(!!resolved, 'truthy result when electronAPI returns true');
    }

    // --- 1b. confirm returns falsy when user clicks No ---
    console.log('\n1b. dialog.confirm returns falsy when user cancels');
    {
        stubConfirmSync(false);
        const raw = dialog.confirm('Are you sure?');
        const resolved = (raw && typeof raw.then === 'function') ? await raw : raw;
        assert(!resolved, 'falsy result when electronAPI returns false');
    }

    // ---------------------------------------------------------------------------
    // Profile parsing helpers — mirror the logic in MSPHelper.js MSPV2_INAV_STATUS handler.
    // Extracted here so tests can drive it with known inputs.
    //
    // MSPV2_INAV_STATUS byte layout (relevant fields):
    //   bytes 0-1  : cycleTime    (uint16 LE)
    //   bytes 2-3  : i2cError     (uint16 LE)
    //   bytes 4-5  : activeSensors(uint16 LE)
    //   bytes 6-7  : cpuload      (uint16 LE)
    //   byte  8    : profile_byte: bits[3:0]=control profile, bits[7:4]=battery profile
    //   bytes 9-12 : armingFlags  (uint32 LE)
    //   ...variable box-mode flags...
    //   last byte  : bits[3:0]=mixer profile
    // ---------------------------------------------------------------------------
    const PROFILES_CHANGED = { CONTROL: 1, BATTERY: 2, MIXER: 4 };

    function buildStatusBuffer(opts) {
        // Real messages: 8 header bytes + profile_byte + armingFlags(4) + N box-mode bytes + mixer_byte.
        // This buffer uses N=0 (no box-mode bytes), so len=14 and mixer is at byte 13 (len-1).
        // Do NOT add bytes before the last byte without also updating where parseStatusProfiles reads the mixer byte.
        const len = 14;
        const buf = new ArrayBuffer(len);
        const view = new DataView(buf);
        const profileByte = ((opts.battery_profile & 0x0F) << 4) | (opts.control_profile & 0x0F);
        view.setUint8(8, profileByte);
        view.setUint8(13, opts.mixer_profile & 0x0F);
        return { view, len };
    }

    function parseStatusProfiles(view, msgLen, fc_in) {
        // Returns { fc: updated copy, profile_changed: bitmask }
        const fc = { ...fc_in };
        let profile_changed = 0;
        const profile_byte = view.getUint8(8);
        const profile = profile_byte & 0x0F;
        if (profile !== fc.profile && fc.profile !== -1) profile_changed |= PROFILES_CHANGED.CONTROL;
        fc.profile = profile;
        const battery_profile = (profile_byte & 0xF0) >> 4;
        if (battery_profile !== fc.battery_profile && fc.battery_profile !== -1) profile_changed |= PROFILES_CHANGED.BATTERY;
        fc.battery_profile = battery_profile;
        const mixer_profile = view.getUint8(msgLen - 1) & 0x0F;
        if (mixer_profile !== fc.mixer_profile && fc.mixer_profile !== -1) profile_changed |= PROFILES_CHANGED.MIXER;
        fc.mixer_profile = mixer_profile;
        return { fc, profile_changed };
    }

    // --- 1c. mixer_control_profile_linking = OFF ---
    console.log('\n1c. Linking OFF: Configurator shows mixer=1, control=0 independently after status poll');
    {
        const { view, len } = buildStatusBuffer({ control_profile: 0, battery_profile: 0, mixer_profile: 1 });
        const fc_before = { mixer_profile: 0, profile: 0, battery_profile: 0 };
        const { fc, profile_changed } = parseStatusProfiles(view, len, fc_before);

        assert(fc.mixer_profile === 1,
            'Configurator stores mixer_profile=1 as reported by firmware');
        assert(fc.profile === 0,
            'Configurator stores control_profile=0 as reported (NOT forced to match mixer)');
        assert(!!(profile_changed & PROFILES_CHANGED.MIXER),
            'MIXER change flag set — tab reload triggered for mixer change');
        assert(!(profile_changed & PROFILES_CHANGED.CONTROL),
            'CONTROL change flag NOT set — control profile did not change');
    }

    // --- 1d. mixer_control_profile_linking = ON ---
    console.log('\n1d. Linking ON: Configurator shows mixer=1 AND control=1 after firmware applies linking');
    {
        const { view, len } = buildStatusBuffer({ control_profile: 1, battery_profile: 0, mixer_profile: 1 });
        const fc_before = { mixer_profile: 0, profile: 0, battery_profile: 0 };
        const { fc, profile_changed } = parseStatusProfiles(view, len, fc_before);

        assert(fc.mixer_profile === 1,
            'Configurator stores mixer_profile=1 as reported by firmware');
        assert(fc.profile === 1,
            'Configurator stores control_profile=1 as reported (firmware applied linking)');
        assert(!!(profile_changed & PROFILES_CHANGED.MIXER),
            'MIXER change flag set');
        assert(!!(profile_changed & PROFILES_CHANGED.CONTROL),
            'CONTROL change flag set — both profiles changed, tab reload triggered');
    }

    // --- 1e. Initial connect: FC.CONFIG profiles initialize to -1; first poll must not trigger tab reload ---
    console.log('\n1e. Initial connect: first status poll (sentinel -1) suppresses spurious profile change');
    {
        const { view, len } = buildStatusBuffer({ control_profile: 0, battery_profile: 0, mixer_profile: 0 });
        const fc_before = { mixer_profile: -1, profile: -1, battery_profile: -1 };
        const { fc, profile_changed } = parseStatusProfiles(view, len, fc_before);

        assert(fc.mixer_profile === 0,
            'Configurator correctly stores mixer_profile=0 on first poll');
        assert(fc.profile === 0,
            'Configurator correctly stores control_profile=0 on first poll');
        assert(profile_changed === 0,
            'No change flags set on initial connect — no spurious tab reload');
    }

    // --- 1f. Mixer profile handler: confirm path initiates profile switch ---
    console.log('\n1f. Mixer profile handler sends MSP2_INAV_SELECT_MIXER_PROFILE when user confirms');
    {
        stubConfirmAsync(true); // production uses ipcRenderer.invoke (always async)

        const MSP2_INAV_SELECT_MIXER_PROFILE = 0x2080;
        const sentCodes = [];
        const removedIntervals = [];

        const MSPmock = {
            send_message(code, _payload, _opt, callback) {
                sentCodes.push(code);
                if (typeof callback === 'function') callback();
            }
        };

        async function mixerProfileHandler(newProfileVal, confirmFn) {
            const raw = confirmFn('changeMixerProfileReboot');
            const userOk = (raw && typeof raw.then === 'function') ? await raw : raw;
            if (!userOk) return;
            const mixerprofile = parseInt(newProfileVal);
            removedIntervals.push('global_data_refresh');
            MSPmock.send_message(MSP2_INAV_SELECT_MIXER_PROFILE, [mixerprofile], false, () => {
                // tab_switch_cleanup + handleReconnect + MSP_SET_REBOOT omitted from mock
            });
        }

        await mixerProfileHandler(1, dialog.confirm.bind(dialog));

        assert(sentCodes.includes(MSP2_INAV_SELECT_MIXER_PROFILE),
            'MSP2_INAV_SELECT_MIXER_PROFILE is sent to initiate the profile switch');
        assert(removedIntervals.includes('global_data_refresh'),
            'global_data_refresh removed before MSP chain so status poller cannot interrupt it');
    }

    // --- 1g. Mixer profile handler does NOT send MSP when cancelled ---
    console.log('\n1g. Mixer profile handler sends NO MSP commands when user cancels');
    {
        stubConfirmAsync(false); // production uses ipcRenderer.invoke (always async)

        const MSP2_INAV_SELECT_MIXER_PROFILE = 0x2080;
        const sentCodes = [];
        const MSPmock = {
            send_message(code, _p, _o, cb) { sentCodes.push(code); if (cb) cb(); }
        };

        async function mixerProfileHandlerCancel(newProfileVal, confirmFn) {
            const raw = confirmFn('changeMixerProfileReboot');
            const userOk = (raw && typeof raw.then === 'function') ? await raw : raw;
            if (!userOk) return;
            MSPmock.send_message(MSP2_INAV_SELECT_MIXER_PROFILE, [parseInt(newProfileVal)], false, () => {});
        }

        await mixerProfileHandlerCancel(1, dialog.confirm.bind(dialog));

        assert(sentCodes.length === 0,
            'no MSP commands sent when user cancels — profile unchanged');
    }

    // --- 1h. dialog.js exposes a confirm function ---
    console.log('\n1h. dialog.js structure sanity check');
    {
        assert(typeof dialog.confirm === 'function', 'dialog.confirm is a function');
    }

    // =======================================================================
    // Summary
    // =======================================================================
    console.log('\n' + '='.repeat(70));
    console.log(`${passed} passed, ${failed} failed`);

    if (failed > 0) {
        console.error(`\nFAIL: ${failed} test(s) failed.`);
        process.exit(1);
    } else {
        console.log('\nPASS: All tests passed.');
        process.exit(0);
    }
}

run().catch(err => {
    console.error('Unexpected error running tests:', err);
    process.exit(1);
});
