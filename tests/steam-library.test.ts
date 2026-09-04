//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for visible-library retrieval, normalization, privacy mapping, and short-lived edge caching.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { retrieveVisibleGames } from '../src/api/games';
import { SharedCache, type SharedCacheStorage } from '../src/cache/cache';
import {
    getOwnedGames,
    InvalidSteamIdError,
    normalizeOwnedGames,
    SteamGameDetailsPrivateError,
    SteamLibraryEmptyError,
} from '../src/steam/library';

const TEST_ICON_HASH = '0123456789abcdef0123456789abcdef01234567';
const TEST_STEAM_ID  = '76561198000000000';

//---------------------------------------------------------------------------------------------------------------------
// Function: createOwnedGamesResponse
//
// Description:
//
//   Creates owned games response from the supplied inputs.
//
// Returns:
//
//   The result produced by the create owned games response operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createOwnedGamesResponse ()
{
    return (
        {
            response:
            {
                game_count: 2,
                games:
                [
                    {
                        appid:           578080,
                        img_icon_url:    TEST_ICON_HASH,
                        name:            'PUBG: BATTLEGROUNDS',
                        playtime_forever: 12_345,
                    },
                    {
                        appid:           620,
                        img_icon_url:    '',
                        name:            'Portal 2',
                        playtime_forever: 800,
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
        { edgeCache, match, put }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSharedCache
//
// Description:
//
//   Creates shared cache from the supplied inputs.
//
// Returns:
//
//   The result produced by the create shared cache operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createSharedCache ()
{
    const values  = new Map<string, string> ();
    const storage =
    {
        read:  vi.fn ( async ( key: string ) => values.get ( key ) ?? null ),
        write: vi.fn ( async ( key: string, value: string ) => void values.set ( key, value ) ),
    } satisfies SharedCacheStorage;

    return new SharedCache ( storage );
}

describe ( 'Steam owned-games adapter', () =>
{
    it ( 'requests app metadata and played free games before normalizing the visible library', async () =>
    {
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL ) =>
            Response.json ( createOwnedGamesResponse () ) );
        const games         = await getOwnedGames ( TEST_STEAM_ID, 'test-api-key', fetchFunction );
        const requestUrl    = fetchFunction.mock.calls [ 0 ]?.[ 0 ];

        expect ( games ).toEqual (
            [
                {
                    achievementCapability: 'unknown',
                    achievementCount:      null,
                    appId:                 578080,
                    bannerUrl:             null,
                    iconUrl:               `https://media.steampowered.com/steamcommunity/public/images/apps/578080/`
                        + `${TEST_ICON_HASH}.jpg`,
                    name:                  'PUBG: BATTLEGROUNDS',
                    playtimeMinutes:       12_345,
                },
                {
                    achievementCapability: 'unknown',
                    achievementCount:      null,
                    appId:                 620,
                    bannerUrl:             null,
                    iconUrl:               null,
                    name:                  'Portal 2',
                    playtimeMinutes:       800,
                },
            ],
        );
        expect ( requestUrl ).toBeInstanceOf ( URL );

        if ( ! ( requestUrl instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam adapter to call fetch with a URL.' );
        }

        expect ( requestUrl.pathname ).toBe ( '/IPlayerService/GetOwnedGames/v1/' );
        expect ( requestUrl.searchParams.get ( 'include_appinfo' ) ).toBe ( 'true' );
        expect ( requestUrl.searchParams.get ( 'include_played_free_games' ) ).toBe ( 'true' );
        expect ( requestUrl.searchParams.get ( 'steamid' ) ).toBe ( TEST_STEAM_ID );
    } );

    it ( 'filters malformed games and combines duplicate records deterministically', () =>
    {
        const games = normalizeOwnedGames (
            [
                { appid: 620, name: 'Portal 2', playtime_forever: 100 },
                {
                    appid:            620,
                    img_icon_url:     TEST_ICON_HASH,
                    name:             'Duplicate Portal 2',
                    playtime_forever: 900,
                },
                { appid: 'invalid', name: 'Invalid AppID' },
                { appid: 10, name: '   ' },
                null,
            ],
        );

        expect ( games ).toHaveLength ( 1 );
        expect ( games [ 0 ] ).toMatchObject (
            {
                appId:           620,
                name:            'Portal 2',
                playtimeMinutes: 900,
            },
        );
        expect ( games [ 0 ]?.iconUrl ).toContain ( TEST_ICON_HASH );
    } );

    it ( 'maps a missing games collection to private Game Details', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json ( { response: {} } ) );

        await expect ( getOwnedGames ( TEST_STEAM_ID, 'test-api-key', fetchFunction ) )
            .rejects.toBeInstanceOf ( SteamGameDetailsPrivateError );
    } );

    it.each ( [ 401, 403 ] ) ( 'maps a Steam %s rejection to private Game Details', async upstreamStatus =>
    {
        const fetchFunction = vi.fn (
            async () => new Response ( 'private upstream body', { status: upstreamStatus } ),
        );

        await expect ( getOwnedGames ( TEST_STEAM_ID, 'test-api-key', fetchFunction ) )
            .rejects.toBeInstanceOf ( SteamGameDetailsPrivateError );
    } );

    it ( 'maps an empty visible games collection separately from privacy', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                response:
                {
                    game_count: 0,
                    games: [],
                },
            },
        ) );

        await expect ( getOwnedGames ( TEST_STEAM_ID, 'test-api-key', fetchFunction ) )
            .rejects.toBeInstanceOf ( SteamLibraryEmptyError );
    } );

    it ( 'rejects an invalid SteamID64 without contacting Steam', async () =>
    {
        const fetchFunction = vi.fn ();

        await expect ( getOwnedGames ( 'invalid', 'test-api-key', fetchFunction ) )
            .rejects.toBeInstanceOf ( InvalidSteamIdError );
        expect ( fetchFunction ).not.toHaveBeenCalled ();
    } );
} );

describe ( 'Visible-library edge cache', () =>
{
    it ( 'reuses normalized library data for five minutes', async () =>
    {
        const { edgeCache, put } = createMemoryCache ();
        const sharedCache        = createSharedCache ();
        const fetchFunction      = vi.fn ( async () => Response.json ( createOwnedGamesResponse () ) );
        const requestUrl         = `https://example.test/api/users/${TEST_STEAM_ID}/games`;

        const firstLibrary = await retrieveVisibleGames (
            TEST_STEAM_ID,
            requestUrl,
            'test-api-key',
            sharedCache,
            fetchFunction,
            edgeCache,
        );
        const secondLibrary = await retrieveVisibleGames (
            TEST_STEAM_ID,
            requestUrl,
            'test-api-key',
            sharedCache,
            fetchFunction,
            edgeCache,
        );

        expect ( secondLibrary ).toEqual ( firstLibrary );
        expect ( fetchFunction ).toHaveBeenCalledTimes ( 1 );
        expect ( put ).toHaveBeenCalledTimes ( 1 );
        expect ( put.mock.calls [ 0 ]?.[ 1 ].headers.get ( 'cache-control' ) ).toBe ( 'public, max-age=300' );
    } );

    it ( 'returns live data when a cache write fails', async () =>
    {
        const edgeCache =
        {
            match: vi.fn ( async () => undefined ),
            put:   vi.fn ( async () => Promise.reject ( new Error ( 'cache unavailable' ) ) ),
        } as unknown as Cache;
        const fetchFunction = vi.fn ( async () => Response.json ( createOwnedGamesResponse () ) );
        const sharedCache   = createSharedCache ();

        await expect ( retrieveVisibleGames (
            TEST_STEAM_ID,
            `https://example.test/api/users/${TEST_STEAM_ID}/games`,
            'test-api-key',
            sharedCache,
            fetchFunction,
            edgeCache,
        ) ).resolves.toMatchObject (
            {
                discoveryCursor: expect.any ( String ),
                games:
                [
                    { appId: 578080 },
                    { appId: 620 },
                ],
            },
        );
    } );
} );
