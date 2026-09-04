//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-29
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for authenticated Steam URL construction, request timeouts, safe response parsing, validation, and
//   normalized upstream errors.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import
{
    createSteamApiUrl,
    isJsonObject,
    requestSteamJson,
    SteamConfigurationError,
    SteamInvalidResponseError,
    SteamRequestFailedError,
    SteamRequestTimeoutError,
    SteamUnavailableError,
} from '../src/steam/client';

//---------------------------------------------------------------------------------------------------------------------
// Test helpers.
//---------------------------------------------------------------------------------------------------------------------

interface ExampleResponse
{
    response:
    {
        value: string;
    };
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isExampleResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the example response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the example response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isExampleResponse ( value: unknown ): value is ExampleResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.response ) )
    {
        return false;
    }

    return typeof value.response.value === 'string';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createRequest
//
// Description:
//
//   Creates request from the supplied inputs.
//
// Returns:
//
//   The result produced by the create request operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createRequest ()
{
    return (
        {
            interfaceName: 'ISteamExample',
            methodName:    'GetExample',
            parameters:
            {
                appid: 440,
                format: 'json',
            },
            validate: isExampleResponse,
            version:  2,
        } as const
    );
}

//---------------------------------------------------------------------------------------------------------------------
// URL construction.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Steam URL construction', () =>
{
    it ( 'places the API key and encoded parameters in the server-side URL', () =>
    {
        const url = createSteamApiUrl ( createRequest (), 'secret value' );

        expect ( url.origin ).toBe ( 'https://api.steampowered.com' );
        expect ( url.pathname ).toBe ( '/ISteamExample/GetExample/v2/' );
        expect ( url.searchParams.get ( 'key' ) ).toBe ( 'secret value' );
        expect ( url.searchParams.get ( 'appid' ) ).toBe ( '440' );
        expect ( url.searchParams.get ( 'format' ) ).toBe ( 'json' );
    } );

    it ( 'rejects missing keys and invalid route segments', () =>
    {
        expect ( () => createSteamApiUrl ( createRequest (), undefined ) ).toThrow ( SteamConfigurationError );
        expect ( () => createSteamApiUrl ( createRequest (), '  ' ) ).toThrow ( SteamConfigurationError );
        expect ( () => createSteamApiUrl (
            {
                ...createRequest (),
                methodName: '../unsafe',
            },
            'secret',
        ) ).toThrow ( SteamConfigurationError );
    } );
} );

//---------------------------------------------------------------------------------------------------------------------
// Requests.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Steam requests', () =>
{
    it ( 'returns only validated JSON', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                response:
                {
                    value: 'expected',
                },
            },
        ) );

        await expect ( requestSteamJson (
            createRequest (),
            {
                apiKey: 'secret',
                fetchFunction,
            },
        ) ).resolves.toEqual (
            {
                response:
                {
                    value: 'expected',
                },
            },
        );
    } );

    it ( 'maps aborted requests to a timeout error', async () =>
    {
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL, init?: RequestInit ) =>
            new Promise<Response> ( ( _resolve, reject ) =>
            {
                init?.signal?.addEventListener ( 'abort', () => reject ( new DOMException ( 'Aborted', 'AbortError' ) ) );
            } ) );

        await expect ( requestSteamJson (
            createRequest (),
            {
                apiKey: 'secret',
                fetchFunction,
                timeoutMilliseconds: 1,
            },
        ) ).rejects.toBeInstanceOf ( SteamRequestTimeoutError );
    } );

    it ( 'maps network failures to a safe unavailable error', async () =>
    {
        const fetchFunction = vi.fn ( async () => Promise.reject ( new Error ( 'sensitive transport details' ) ) );

        await expect ( requestSteamJson (
            createRequest (),
            {
                apiKey: 'secret',
                fetchFunction,
            },
        ) ).rejects.toBeInstanceOf ( SteamUnavailableError );
    } );

    it ( 'maps non-success responses without parsing or leaking their bodies', async () =>
    {
        const fetchFunction = vi.fn ( async () => new Response ( 'sensitive upstream body', { status: 403 } ) );
        const error         = await requestSteamJson (
            createRequest (),
            {
                apiKey: 'secret',
                fetchFunction,
            },
        ).catch ( ( reason: unknown ) => reason );

        expect ( error ).toBeInstanceOf ( SteamRequestFailedError );
        expect ( error ).toMatchObject (
            {
                code:           'STEAM_REQUEST_FAILED',
                status:         502,
                upstreamStatus: 403,
            },
        );
        expect ( String ( error ) ).not.toContain ( 'sensitive upstream body' );
    } );

    it ( 'rejects malformed JSON without leaking the raw body', async () =>
    {
        const fetchFunction = vi.fn ( async () => new Response ( 'sensitive malformed body' ) );
        const error         = await requestSteamJson (
            createRequest (),
            {
                apiKey: 'secret',
                fetchFunction,
            },
        ).catch ( ( reason: unknown ) => reason );

        expect ( error ).toBeInstanceOf ( SteamInvalidResponseError );
        expect ( String ( error ) ).not.toContain ( 'sensitive malformed body' );
    } );

    it ( 'rejects valid JSON with an unexpected shape', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json ( { unexpected: true } ) );

        await expect ( requestSteamJson (
            createRequest (),
            {
                apiKey: 'secret',
                fetchFunction,
            },
        ) ).rejects.toBeInstanceOf ( SteamInvalidResponseError );
    } );
} );
