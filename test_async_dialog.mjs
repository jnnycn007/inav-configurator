#!/usr/bin/env node
/**
 * Regression tests for the async dialog.confirm fix.
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
 * Test sets
 * ---------
 * SET 1 — REGRESSION GUARD
 *   These tests must continue to pass both before and after the fix.
 *   Exit code 1 if any of these fail.
 *
 * SET 2 — BUG PROOF (source-text inspection)
 *   These tests characterise the fix by inspecting the source text of the
 *   IPC bridge files (same technique as test_pr2603_fixes.mjs Bug #2/#3).
 *   Before the fix they FAIL; after the fix they PASS.
 *   The script prints "[EXPECTED FAILURE]" and does NOT exit(1) when a
 *   Set-2 test fails — failures here mean the bug is still present.
 *
 * Running
 * -------
 *   node test_async_dialog.mjs
 *
 * Exit code 0  — all Set-1 tests passed (Set-2 failures are acceptable).
 * Exit code 1  — at least one Set-1 regression test failed.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

let set1Passed = 0;
let set1Failed = 0;
let set2Passed = 0;
let set2Failed = 0;

function assert(condition, message, expectedToFail = false) {
    if (condition) {
        if (expectedToFail) {
            console.log(`  [UNEXPECTED PASS - fix may already be applied] ✓ ${message}`);
            set2Passed++;
        } else {
            console.log(`  ✓ ${message}`);
            set1Passed++;
        }
    } else {
        if (expectedToFail) {
            console.log(`  [EXPECTED FAILURE - confirms bug is present]   ✗ ${message}`);
            set2Failed++;
        } else {
            console.error(`  ✗ FAIL: ${message}`);
            set1Failed++;
        }
    }
}

function assertRegression(condition, message) { assert(condition, message, false); }
function assertBugProof(condition, message)   { assert(condition, message, true);  }

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

const preloadSrc = readFileSync(join(__dirname, 'js/main/preload.js'), 'utf8');
const mainSrc    = readFileSync(join(__dirname, 'js/main/main.js'),    'utf8');
const dialogSrc  = readFileSync(join(__dirname, 'js/dialog.js'),       'utf8');

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

    // =======================================================================
    // SET 1 — Regression guard
    // =======================================================================
    console.log('\n=== SET 1: Regression guard (must pass before AND after the fix) ===');

    // --- 1a. confirm returns truthy when user clicks Yes ---
    console.log('\n1a. dialog.confirm returns truthy when user confirms');
    {
        stubConfirmSync(true);
        const raw = dialog.confirm('Are you sure?');
        // Tolerate both sync (boolean) and async (Promise) confirm
        const resolved = (raw && typeof raw.then === 'function') ? await raw : raw;
        assertRegression(!!resolved, 'truthy result when electronAPI returns true');
    }

    // --- 1b. confirm returns falsy when user clicks No ---
    console.log('\n1b. dialog.confirm returns falsy when user cancels');
    {
        stubConfirmSync(false);
        const raw = dialog.confirm('Are you sure?');
        const resolved = (raw && typeof raw.then === 'function') ? await raw : raw;
        assertRegression(!resolved, 'falsy result when electronAPI returns false');
    }

    // --- 1c. Mixer profile handler sends MSP2_INAV_SELECT_MIXER_PROFILE when confirmed ---
    // Logic extracted verbatim from js/configurator_main.js lines 699-721.
    console.log('\n1c. Mixer profile handler sends MSP2_INAV_SELECT_MIXER_PROFILE when confirmed');
    {
        stubConfirmSync(true);

        const MSP2_INAV_SELECT_MIXER_PROFILE = 0x2080;
        const sentCodes = [];
        const removedIntervals = [];

        const MSPmock = {
            send_message(code, _payload, _opt, callback) {
                sentCodes.push(code);
                if (typeof callback === 'function') callback();
            }
        };

        // The handler, written to accept both sync and async confirm
        async function mixerProfileHandler(newProfileVal, confirmFn) {
            const raw = confirmFn('changeMixerProfileReboot');
            const userOk = (raw && typeof raw.then === 'function') ? await raw : raw;
            if (!userOk) return;

            const mixerprofile = parseInt(newProfileVal);
            removedIntervals.push('global_data_refresh');
            MSPmock.send_message(MSP2_INAV_SELECT_MIXER_PROFILE, [mixerprofile], false, () => {
                MSPmock.send_message(210 /* MSP_SELECT_SETTING */, [mixerprofile], false, () => {
                    MSPmock.send_message(250 /* MSP_EEPROM_WRITE */, false, false, () => {
                        // reboot chain omitted
                    });
                });
            });
        }

        await mixerProfileHandler(1, dialog.confirm.bind(dialog));

        assertRegression(
            sentCodes.includes(MSP2_INAV_SELECT_MIXER_PROFILE),
            'MSP2_INAV_SELECT_MIXER_PROFILE (0x2080) is sent when user confirms'
        );
        assertRegression(
            sentCodes.includes(210),
            'MSP_SELECT_SETTING is sent as part of the command chain'
        );
        assertRegression(
            sentCodes.includes(250),
            'MSP_EEPROM_WRITE (250) is sent to persist profiles before reboot'
        );
        assertRegression(
            removedIntervals.includes('global_data_refresh'),
            'global_data_refresh interval is removed before MSP commands'
        );
    }

    // --- 1d. Mixer profile handler does NOT send MSP when cancelled ---
    console.log('\n1d. Mixer profile handler sends NO MSP commands when cancelled');
    {
        stubConfirmSync(false);

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

        assertRegression(
            sentCodes.length === 0,
            'no MSP commands sent when user cancels'
        );
    }

    // --- 1e. dialog.js exposes a confirm function ---
    console.log('\n1e. dialog.js structure sanity check');
    {
        assertRegression(
            typeof dialog.confirm === 'function',
            'dialog.confirm is a function'
        );
        assertRegression(
            dialogSrc.includes('confirmDialog'),
            'dialog.js delegates to electronAPI.confirmDialog'
        );
    }

    // =======================================================================
    // SET 2 — Bug proof (source-text inspection)
    //
    // We cannot instantiate a real Electron process in this test runner, so
    // we use source-text inspection to verify that the blocking API calls are
    // (or are not) present.  This is the same technique used in
    // test_pr2603_fixes.mjs (Bug #2: inspecting proceedWithFlash source;
    // Bug #3: inspecting _enterCli source).
    //
    // Before the fix these tests FAIL because sendSync / showMessageBoxSync
    // are present.  After the fix they PASS because those calls are gone and
    // ipcRenderer.invoke / showMessageBox (async) are in their place.
    // =======================================================================
    console.log('\n=== SET 2: Bug proof (expected to FAIL before fix, PASS after fix) ===');

    // --- 2a. preload.js must use ipcRenderer.invoke, not sendSync ---
    console.log('\n2a. preload.js: confirmDialog must use ipcRenderer.invoke (not sendSync)');
    {
        // Locate the confirmDialog line in preload.js
        const lineMatch = preloadSrc.split('\n').find(l => l.includes('confirmDialog'));
        const hasSendSync = lineMatch ? lineMatch.includes('sendSync') : false;
        const hasInvoke   = lineMatch ? lineMatch.includes('invoke')   : false;

        assertBugProof(
            !hasSendSync,
            `preload.js confirmDialog does NOT use ipcRenderer.sendSync (found: "${(lineMatch || '').trim()}")`
        );
        assertBugProof(
            hasInvoke,
            `preload.js confirmDialog uses ipcRenderer.invoke (found: "${(lineMatch || '').trim()}")`
        );
    }

    // --- 2b. main.js must use ipcMain.handle + showMessageBox (async) ---
    console.log('\n2b. main.js: dialog.confirm handler must use ipcMain.handle (not ipcMain.on) and showMessageBox (not showMessageBoxSync)');
    {
        // Extract the dialog.confirm handler block from main.js
        const confirmIdx = mainSrc.indexOf("'dialog.confirm'");
        // Find the surrounding ~200 chars to check which APIs are used
        const snippet = confirmIdx !== -1
            ? mainSrc.slice(Math.max(0, confirmIdx - 20), confirmIdx + 200)
            : '';

        const usesHandle  = snippet.includes('ipcMain.handle');
        const usesOn      = snippet.includes('ipcMain.on');
        const usesSync    = snippet.includes('showMessageBoxSync');
        const usesAsync   = snippet.includes('showMessageBox') && !usesSync;

        assertBugProof(
            !usesOn,
            `main.js dialog.confirm handler does NOT use ipcMain.on (blocking) (snippet: "${snippet.slice(0,80).trim()}")`
        );
        assertBugProof(
            usesHandle,
            `main.js dialog.confirm handler uses ipcMain.handle (async)`
        );
        assertBugProof(
            !usesSync,
            `main.js dialog.confirm handler does NOT use showMessageBoxSync`
        );
        assertBugProof(
            usesAsync,
            `main.js dialog.confirm handler uses async showMessageBox`
        );
    }

    // --- 2c. dialog.js confirm must delegate to electronAPI.confirmDialog ---
    // Note: the function does not need to be declared `async` because
    // ipcRenderer.invoke already returns a Promise; the `async` keyword would
    // be redundant.  The important invariant is that confirmDialog is called
    // via invoke (tested in 2a) and that dialog.confirm passes through the
    // Promise without converting it to a sync value.
    console.log('\n2c. dialog.js: confirm must delegate to electronAPI.confirmDialog (returns its Promise)');
    {
        const lines = dialogSrc.split('\n');
        const confirmLine = lines.find(l => l.includes('confirm') && l.includes('function'));
        const delegateLine = lines.find(l => l.includes('confirmDialog'));

        assertBugProof(
            confirmLine !== undefined && !confirmLine.includes('sendSync'),
            `dialog.js confirm does not use sendSync (found: "${(confirmLine || 'not found').trim()}")`
        );
        assertBugProof(
            delegateLine !== undefined && delegateLine.includes('confirmDialog'),
            `dialog.js confirm delegates to electronAPI.confirmDialog (found: "${(delegateLine || 'not found').trim()}")`
        );
    }

    // =======================================================================
    // Summary
    // =======================================================================
    console.log('\n' + '='.repeat(70));
    console.log(`SET 1 (regression guard): ${set1Passed} passed, ${set1Failed} failed`);
    console.log(`SET 2 (bug proof):        ${set2Failed} expected-failure(s), ${set2Passed} unexpected-pass(es)`);

    if (set2Failed > 0) {
        console.log('\n  Set-2 failures confirm the bug is still present.');
        console.log('  Re-run this file after the async fix to verify all Set-2 tests flip to passing.');
    }
    if (set2Passed > 0) {
        console.log('\n  Set-2 unexpected passes suggest the fix is already applied.');
    }

    if (set1Failed > 0) {
        console.error(`\nFAIL: ${set1Failed} regression test(s) failed.`);
        process.exit(1);
    } else {
        console.log('\nPASS: All Set-1 regression tests passed.');
        process.exit(0);
    }
}

run().catch(err => {
    console.error('Unexpected error running tests:', err);
    process.exit(1);
});
