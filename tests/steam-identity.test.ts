//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for Steam identifier parsing, user endpoint adapters, normalized profile mapping, and short-lived
//   user-profile edge caching.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { resolveUser } from '../src/api/user';
import { SteamInvalidResponseError } from '../src/steam/client';
import {
    InvalidSteamUserIdentifierError,
    parseSteamIdentifier,
    resolveSteamUser,
    SteamProfilePrivateError,
    SteamUserNotFoundError,
} from '../src/steam/identity';

//---------------------------------------------------------------------------------------------------------------------
// Test data and helpers.
//---------------------------------------------------------------------------------------------------------------------

const TEST_STEAM_ID = '76561198000000000';

//---------------------------------------------------------------------------------------------------------------------
// Function: createPlayerSummariesResponse
//
// Description:
//
//   Creates player summaries response from the supplied inputs.
//
// Returns:
//
//   The result produced by the create player summaries response operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createPlayerSummariesResponse ()
{
    return (
        {
            response:
            {
                players:
                [
                    {
                        avatar:       'https://cdn.example/avatar-small.jpg',
                        avatarfull:   'https://cdn.example/avatar-full.jpg',
                        avatarmedium: 'https://cdn.example/avatar-medium.jpg',
                        communityvisibilitystate: 3,
                        personaname:  'Example User',
                        profileurl:   'https://steamcommunity.com/id/exampleuser/',
                        steamid:      TEST_STEAM_ID,
                    },
                ],
            },
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createMemoryCache
//
// Description:
//
//   Creates memory cache from the supplied inputs.
//
// Returns:
//
//   The result produced by the create memory cache operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createMemoryCache ()
{
    const storedResponses = new Map<string, Response> ();
    const match           = vi.fn ( async ( request: Request ) => storedResponses.get ( request.url )?.clone () );
    const put             = vi.fn ( async ( request: Request, response: Response ) =>
    {
        storedResponses.set ( request.url, response.clone () );
    } );
    const edgeCache       = { match, put } as unknown as Cache;

    return (
        { edgeCache, match, put, storedResponses }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Identifier parsing.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Steam identifier parsing', () =>
{
    it.each (
        [
            [
                'SteamID64',
                TEST_STEAM_ID,
                { kind: 'steamId', steamId: TEST_STEAM_ID },
            ],
            [
                'profile URL',
                `https://steamcommunity.com/profiles/${TEST_STEAM_ID}/`,
                { kind: 'steamId', steamId: TEST_STEAM_ID },
            ],
            [
                'www profile URL',
                `https://www.steamcommunity.com/profiles/${TEST_STEAM_ID}`,
                { kind: 'steamId', steamId: TEST_STEAM_ID },
            ],
            [
                'custom profile URL',
                'https://steamcommunity.com/id/Example_User-2/',
                { kind: 'vanity', vanityIdentifier: 'Example_User-2' },
            ],
            [
                'vanity identifier',
                'exampleuser',
                { kind: 'vanity', vanityIdentifier: 'exampleuser' },
            ],
        ],
    ) ( 'parses a supported %s', ( _description, input, expected ) =>
    {
        expect ( parseSteamIdentifier ( input ) ).toEqual ( expected );
    } );

    it.each (
        [
            '',
            '12345',
            'https://steamcommunity.com/profiles/not-a-steam-id/',
            'https://steamcommunity.com/id/exampleuser/extra',
            'http://steamcommunity.com/id/exampleuser/',
            'https://example.com/id/exampleuser/',
            'https://steamcommunity.com/id/exampleuser/?query=unexpected',
            'display name with spaces',
        ],
    ) ( 'rejects invalid input %s', input =>
    {
        expect ( () => parseSteamIdentifier ( input ) ).toThrow ( InvalidSteamUserIdentifierError );
    } );
} );

//---------------------------------------------------------------------------------------------------------------------
// Steam endpoint adapters.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Steam user endpoint adapters', () =>
{
    it ( 'resolves a vanity identifier before normalizing the player summary', async () =>
    {
        const fetchFunction = vi.fn ()
            .mockResolvedValueOnce ( Response.json (
                {
                    response:
                    {
                        steamid: TEST_STEAM_ID,
                        success: 1,
                    },
                },
            ) )
            .mockResolvedValueOnce ( Response.json ( createPlayerSummariesResponse () ) );

        const user = await resolveSteamUser (
            { kind: 'vanity', vanityIdentifier: 'exampleuser' },
            'test-api-key',
            fetchFunction,
        );
        const resolveUrl = fetchFunction.mock.calls [ 0 ]?.[ 0 ];
        const summaryUrl = fetchFunction.mock.calls [ 1 ]?.[ 0 ];

        expect ( user ).toEqual (
            {
                avatarUrl:  'https://cdn.example/avatar-full.jpg',
                personaName: 'Example User',
                profileUrl:  'https://steamcommunity.com/id/exampleuser/',
                steamId:     TEST_STEAM_ID,
            },
        );
        expect ( resolveUrl ).toBeInstanceOf ( URL );
        expect ( summaryUrl ).toBeInstanceOf ( URL );

        if ( ! ( resolveUrl instanceof URL ) || ! ( summaryUrl instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam adapters to call fetch with URL values.' );
        }

        expect ( resolveUrl.pathname ).toBe ( '/ISteamUser/ResolveVanityURL/v1/' );
        expect ( resolveUrl.searchParams.get ( 'vanityurl' ) ).toBe ( 'exampleuser' );
        expect ( resolveUrl.searchParams.get ( 'url_type' ) ).toBe ( '1' );
        expect ( summaryUrl.pathname ).toBe ( '/ISteamUser/GetPlayerSummaries/v2/' );
        expect ( summaryUrl.searchParams.get ( 'steamids' ) ).toBe ( TEST_STEAM_ID );
    } );

    it ( 'maps an unresolved vanity identifier to user not found', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                response:
                {
                    message: 'No match',
                    success: 42,
                },
            },
        ) );

        await expect ( resolveSteamUser (
            { kind: 'vanity', vanityIdentifier: 'missing-user' },
            'test-api-key',
            fetchFunction,
        ) ).rejects.toBeInstanceOf ( SteamUserNotFoundError );
    } );

    it ( 'maps an empty player summary to user not found', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                response:
                {
                    players: [],
                },
            },
        ) );

        await expect ( resolveSteamUser (
            { kind: 'steamId', steamId: TEST_STEAM_ID },
            'test-api-key',
            fetchFunction,
        ) ).rejects.toBeInstanceOf ( SteamUserNotFoundError );
    } );

    it.each ( [ 1, 2 ] ) ( 'maps sparse visibility state %s to profile privacy', async visibilityState =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                response:
                {
                    players:
                    [
                        {
                            communityvisibilitystate: visibilityState,
                            steamid: TEST_STEAM_ID,
                        },
                    ],
                },
            },
        ) );

        await expect ( resolveSteamUser (
            { kind: 'steamId', steamId: TEST_STEAM_ID },
            'test-api-key',
            fetchFunction,
        ) ).rejects.toBeInstanceOf ( SteamProfilePrivateError );
    } );

    it ( 'uses a null avatar fallback when optional image URLs are unusable', async () =>
    {
        const response = createPlayerSummariesResponse ();
        const player   = response.response.players [ 0 ];

        if ( player === undefined )
        {
            throw new TypeError ( 'Expected the test response to contain one player.' );
        }

        player.avatar       = '';
        player.avatarfull   = 'javascript:unexpected';
        player.avatarmedium = 'not a URL';

        const fetchFunction = vi.fn ( async () => Response.json ( response ) );
        const user          = await resolveSteamUser (
            { kind: 'steamId', steamId: TEST_STEAM_ID },
            'test-api-key',
            fetchFunction,
        );

        expect ( user.avatarUrl ).toBeNull ();
    } );

    it ( 'rejects an unsafe profile URL in otherwise valid player data', async () =>
    {
        const response = createPlayerSummariesResponse ();
        const player   = response.response.players [ 0 ];

        if ( player === undefined )
        {
            throw new TypeError ( 'Expected the test response to contain one player.' );
        }

        player.profileurl = 'javascript:unexpected';

        const fetchFunction = vi.fn ( async () => Response.json ( response ) );

        await expect ( resolveSteamUser (
            { kind: 'steamId', steamId: TEST_STEAM_ID },
            'test-api-key',
            fetchFunction,
        ) ).rejects.toBeInstanceOf ( SteamInvalidResponseError );
    } );

    it ( 'rejects malformed successful vanity responses', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                response:
                {
                    steamid: 'not-a-steam-id',
                    success: 1,
                },
            },
        ) );

        await expect ( resolveSteamUser (
            { kind: 'vanity', vanityIdentifier: 'exampleuser' },
            'test-api-key',
            fetchFunction,
        ) ).rejects.toBeInstanceOf ( SteamInvalidResponseError );
    } );
} );

//---------------------------------------------------------------------------------------------------------------------
// Short-lived user cache.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'User profile edge cache', () =>
{
    it ( 'reuses a vanity result through its normalized SteamID64 alias', async () =>
    {
        const { edgeCache, put } = createMemoryCache ();
        const fetchFunction      = vi.fn ()
            .mockResolvedValueOnce ( Response.json (
                {
                    response:
                    {
                        steamid: TEST_STEAM_ID,
                        success: 1,
                    },
                },
            ) )
            .mockResolvedValueOnce ( Response.json ( createPlayerSummariesResponse () ) );

        const firstUser = await resolveUser (
            'ExampleUser',
            'https://example.test/api/users/ExampleUser',
            'test-api-key',
            fetchFunction,
            edgeCache,
        );
        const secondUser = await resolveUser (
            TEST_STEAM_ID,
            `https://example.test/api/users/${TEST_STEAM_ID}`,
            'test-api-key',
            fetchFunction,
            edgeCache,
        );

        expect ( secondUser ).toEqual ( firstUser );
        expect ( fetchFunction ).toHaveBeenCalledTimes ( 2 );
        expect ( put ).toHaveBeenCalledTimes ( 2 );

        const cachedResponse = put.mock.calls [ 0 ]?.[ 1 ];

        expect ( cachedResponse?.headers.get ( 'cache-control' ) ).toBe ( 'public, max-age=600' );
    } );

    it ( 'returns live data when a cache write fails', async () =>
    {
        const edgeCache =
        {
            match: vi.fn ( async () => undefined ),
            put:   vi.fn ( async () => Promise.reject ( new Error ( 'cache unavailable' ) ) ),
        } as unknown as Cache;
        const fetchFunction = vi.fn ( async () => Response.json ( createPlayerSummariesResponse () ) );

        await expect ( resolveUser (
            TEST_STEAM_ID,
            `https://example.test/api/users/${TEST_STEAM_ID}`,
            'test-api-key',
            fetchFunction,
            edgeCache,
        ) ).resolves.toMatchObject (
            {
                steamId: TEST_STEAM_ID,
            },
        );
    } );
} );
