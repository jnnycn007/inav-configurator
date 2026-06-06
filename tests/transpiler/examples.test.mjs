#!/usr/bin/env node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import examples from '../../js/transpiler/examples/index.js';
import { Transpiler } from '../../js/transpiler/transpiler/index.js';

for (const [name, example] of Object.entries(examples)) {
    test(`transpiler example: ${name}`, () => {
        const transpiler = new Transpiler();
        const result = transpiler.transpile(example.code);
        const errors = result.warnings?.errors ?? [];
        assert.equal(
            errors.length,
            0,
            errors.map(e => `Line ${e.line}: ${e.message}`).join('; ')
        );
    });
}
