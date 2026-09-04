//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/security-review.test.js
//
// Description:
//   Enforces the Phase 14 secret-boundary, public-asset, input-validation, and credential-free frontend invariants.
//---------------------------------------------------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { validateAppId } from '../src/steam/achievements';
import {
    requestSteamJson,
    SteamUnavailableError,
} from '../src/steam/client';
import {
    InvalidSteamUserIdentifierError,
    parseSteamIdentifier,
} from '../src/steam/identity';
import { InvalidSteamIdError, validateSteamId } from '../src/steam/library';

const PROJECT_DIRECTORY_PATH = dirname ( dirname ( fileURLToPath ( import.meta.url ) ) );
const PUBLIC_DIRECTORY_PATH  = join ( PROJECT_DIRECTORY_PATH, 'public' );
const TEXT_FILE_EXTENSIONS   = new Set ( [ '.css', '.html', '.js', '.json', '.jsonc', '.txt' ] );

//---------------------------------------------------------------------------------------------------------------------
// Function: collectTextFileSources
//
// Description:
//
//   Collects text file sources into a deterministic result.
//
// Parameters:
//
// - directoryPath (string):
//   The directory whose relevant files are processed.
//
// Returns:
//
//   The result produced by the collect text file sources operation.
//
//---------------------------------------------------------------------------------------------------------------------

function collectTextFileSources ( directoryPath )
{
    const sourcesByRelativePath = new Map ();

    for ( const directoryEntry of readdirSync ( directoryPath, { withFileTypes: true } ) )
    {
        const entryPath = join ( directoryPath, directoryEntry.name );

        if ( directoryEntry.isDirectory () )
        {
            const nestedSources = collectTextFileSources ( entryPath );

            for ( const [ nestedPath, source ] of nestedSources )
            {
                sourcesByRelativePath.set ( nestedPath, source );
            }

            continue;
        }

        if ( TEXT_FILE_EXTENSIONS.has ( extname ( directoryEntry.name ).toLowerCase () ) )
        {
            sourcesByRelativePath.set (
                relative ( PUBLIC_DIRECTORY_PATH, entryPath ),
                readFileSync ( entryPath, 'utf8' ),
            );
        }
    }

    return sourcesByRelativePath;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSteamRequest
//
// Description:
//
//   Creates steam request from the supplied inputs.
//
// Returns:
//
//   The result produced by the create steam request operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createSteamRequest ()
{
    return (
        {
            interfaceName: 'ITestInterface',
            methodName:    'GetTestData',
            validate:      value => typeof value === 'object' && value !== null,
            version:       1,
        }
    );
}

describe ( 'Secret and public-asset boundaries', () =>
{
    it ( 'keeps authenticated Steam API details out of every public text asset', () =>
    {
        const publicSources = collectTextFileSources ( PUBLIC_DIRECTORY_PATH );

        expect ( publicSources.size ).toBeGreaterThan ( 0 );

        for ( const [ relativePath, source ] of publicSources )
        {
            expect ( source, relativePath ).not.toContain ( 'STEAM_API_KEY' );
            expect ( source, relativePath ).not.toContain ( 'api.steampowered.com' );
            expect ( source, relativePath ).not.toMatch ( /\b[A-Fa-f0-9]{32}\b/ );
        }
    } );

    it ( 'declares the production secret without storing its value and ignores local secret files', () =>
    {
        const wranglerSource        = readFileSync ( join ( PROJECT_DIRECTORY_PATH, 'wrangler.jsonc' ), 'utf8' );
        const wranglerConfiguration = JSON.parse ( wranglerSource );
        const ignoreSource          = readFileSync ( join ( PROJECT_DIRECTORY_PATH, '.gitignore' ), 'utf8' );
        const exampleSource         = readFileSync ( join ( PROJECT_DIRECTORY_PATH, '.dev.vars.example' ), 'utf8' );

        expect ( wranglerConfiguration.secrets?.required ).toEqual ( [ 'STEAM_API_KEY' ] );
        expect ( wranglerSource ).not.toMatch ( /"vars"\s*:/ );
        expect ( ignoreSource ).toMatch ( /^\.dev\.vars$/m );
        expect ( ignoreSource ).toMatch ( /^\.dev\.vars\.\*$/m );
        expect ( exampleSource ).toContain ( 'STEAM_API_KEY=replace-with-a-steam-web-api-key' );
        expect ( exampleSource ).not.toMatch ( /STEAM_API_KEY\s*=\s*[A-Fa-f0-9]{32}/ );
    } );

    it ( 'contains no Steam credential or sign-in form', () =>
    {
        const indexSource = readFileSync ( join ( PUBLIC_DIRECTORY_PATH, 'index.html' ), 'utf8' );

        expect ( indexSource ).not.toMatch ( /<input\b[^>]*\btype\s*=\s*["']password["']/i );
        expect ( indexSource ).not.toMatch ( /<form\b[^>]*\baction\s*=/i );
        expect ( indexSource ).not.toMatch ( /\bname\s*=\s*["'](?:credential|password|steam-password)["']/i );
    } );
} );

describe ( 'Authenticated upstream boundary', () =>
{
    it ( 'discards a transport failure containing the authenticated URL', async () =>
    {
        const apiKey        = 'security-test-api-key';
        const fetchFunction = vi.fn ( async request =>
        {
            throw new Error ( `Transport failed for ${String ( request )}` );
        } );
        let capturedError;

        try
        {
            await requestSteamJson (
                createSteamRequest (),
                {
                    apiKey,
                    fetchFunction,
                },
            );
        }
        catch ( error )
        {
            capturedError = error;
        }

        expect ( capturedError ).toBeInstanceOf ( SteamUnavailableError );
        expect ( String ( capturedError ) ).not.toContain ( apiKey );
        expect ( JSON.stringify ( capturedError ) ).not.toContain ( apiKey );
    } );
} );

describe ( 'Public identifier validation', () =>
{
    it.each (
        [
            'example%2Fadmin',
            'https://steamcommunity.com/id/example%2Fadmin/',
            'https://user:password@steamcommunity.com/id/exampleuser/',
            'https://steamcommunity.com/id/exampleuser/#unexpected',
        ],
    ) ( 'rejects unsafe vanity input %s', identifier =>
    {
        expect ( () => parseSteamIdentifier ( identifier ) ).toThrow ( InvalidSteamUserIdentifierError );
    } );

    it.each (
        [
            '7656119800000000',
            '765611980000000000',
            '7656119800000000x',
            '76561198000000000/achievements',
        ],
    ) ( 'rejects invalid SteamID input %s', steamId =>
    {
        expect ( () => validateSteamId ( steamId ) ).toThrow ( InvalidSteamIdError );
    } );

    it.each ( [ 0, -1, 1.5, 4_294_967_296, Number.MAX_SAFE_INTEGER ] ) (
        'rejects invalid AppID input %s',
        appId =>
        {
            expect ( () => validateAppId ( appId ) ).toThrow ( RangeError );
        },
    );
} );
