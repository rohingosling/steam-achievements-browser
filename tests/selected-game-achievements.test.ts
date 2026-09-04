//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for selected-game aggregation, schema-authoritative merges, progress calculation, shared metadata
//   caching, rarity degradation, no-achievement handling, and short-lived user-specific edge caching.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import {
    calculateAchievementProgress,
    mergeAchievements,
    retrieveSelectedGameAchievements,
    SteamGameHasNoAchievementsError,
} from '../src/api/achievements';
import { gameMetadataCacheKey, globalRarityCacheKey } from '../src/cache/cache-keys';
import { SharedCache, type SharedCacheStorage } from '../src/cache/cache';
import type { AchievementDefinition, PlayerAchievementState } from '../src/model/api';

//---------------------------------------------------------------------------------------------------------------------
// Test helpers.
//---------------------------------------------------------------------------------------------------------------------

const STEAM_ID = '76561198000000000';
const GAME_ICON_URL =
    'https://media.steampowered.com/steamcommunity/public/images/apps/620/0123456789abcdef0123456789abcdef01234567.jpg';

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

    return (
        { cache: new SharedCache ( storage ), storage, values }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createEdgeCache
//
// Description:
//
//   Creates edge cache from the supplied inputs.
//
// Returns:
//
//   The result produced by the create edge cache operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createEdgeCache ()
{
    const values = new Map<string, Response> ();
    const match  = vi.fn ( async ( request: Request ) => values.get ( request.url )?.clone () );
    const put    = vi.fn ( async ( request: Request, response: Response ) =>
    {
        values.set ( request.url, response.clone () );
    } );
    const cache = { match, put } as unknown as Cache;

    return (
        { cache, match, put, values }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: collectPropertyNames
//
// Description:
//
//   Collects property names into a deterministic result.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// - propertyNames (unknown):
//   The property names used by the operation.
//
// Returns:
//
//   The resulting Set<string> value.
//
//---------------------------------------------------------------------------------------------------------------------

function collectPropertyNames ( value: unknown, propertyNames = new Set<string> () ): Set<string>
{
    if ( Array.isArray ( value ) )
    {
        value.forEach ( item => collectPropertyNames ( item, propertyNames ) );

        return propertyNames;
    }

    if ( typeof value !== 'object' || value === null )
    {
        return propertyNames;
    }

    Object.entries ( value ).forEach ( ( [ propertyName, propertyValue ] ) =>
    {
        propertyNames.add ( propertyName );
        collectPropertyNames ( propertyValue, propertyNames );
    } );

    return propertyNames;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: collectStringValues
//
// Description:
//
//   Collects string values into a deterministic result.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// - stringValues (string []):
//   The string values used by the operation.
//
// Returns:
//
//   The resulting string [] value.
//
//---------------------------------------------------------------------------------------------------------------------

function collectStringValues ( value: unknown, stringValues: string [] = [] ): string []
{
    if ( Array.isArray ( value ) )
    {
        value.forEach ( item => collectStringValues ( item, stringValues ) );

        return stringValues;
    }

    if ( typeof value === 'object' && value !== null )
    {
        Object.values ( value ).forEach ( propertyValue => collectStringValues ( propertyValue, stringValues ) );
    }
    else if ( typeof value === 'string' )
    {
        stringValues.push ( value );
    }

    return stringValues;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSchemaDefinitions
//
// Description:
//
//   Creates schema definitions from the supplied inputs.
//
// Returns:
//
//   The resulting AchievementDefinition [] value.
//
//---------------------------------------------------------------------------------------------------------------------

function createSchemaDefinitions (): AchievementDefinition []
{
    return [
        {
            apiName:     'UNLOCKED',
            description: 'Complete the first test.',
            iconGrayUrl: 'https://cdn.example/unlocked-gray.jpg',
            iconUrl:     'https://cdn.example/unlocked.jpg',
            name:        'Unlocked Achievement',
        },
        {
            apiName:     'LOCKED',
            description: null,
            iconGrayUrl: null,
            iconUrl:     null,
            name:        'Hidden Achievement',
        },
    ];
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createAggregationFetch
//
// Description:
//
//   Creates aggregation fetch from the supplied inputs.
//
// Parameters:
//
// - options ({ itemProgressUnavailable?: boolean; noAchievements?: boolean; rarityUnavailable?: boolean;
// storeUnavailable?: boolean; }):
//   Optional dependencies and policy overrides for the operation.
//
// Returns:
//
//   The result produced by the create aggregation fetch operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createAggregationFetch
(
    options:
    {
        itemProgressUnavailable?: boolean;
        noAchievements?: boolean;
        rarityUnavailable?: boolean;
        storeUnavailable?: boolean;
    } = {},
)
{
    return vi.fn ( async ( input: RequestInfo | URL ) =>
    {
        const url = input instanceof URL ? input : new URL ( String ( input ) );

        if ( url.origin === 'https://store.steampowered.com' )
        {
            if ( options.storeUnavailable )
            {
                return new Response ( '', { status: 503 } );
            }

            return Response.json (
                {
                    620:
                    {
                        data:
                        {
                            header_image: 'https://cdn.example/header.jpg',
                            name:         'Portal 2 Store Name',
                        },
                        success: true,
                    },
                },
            );
        }

        if ( url.pathname.includes ( 'GetOwnedGames' ) )
        {
            return Response.json (
                {
                    response:
                    {
                        game_count: 1,
                        games:
                        [
                            {
                                appid:            620,
                                img_icon_url:     '0123456789abcdef0123456789abcdef01234567',
                                name:             'Portal 2',
                                playtime_forever: 800,
                            },
                        ],
                    },
                },
            );
        }

        if ( url.pathname.includes ( 'GetSchemaForGame' ) )
        {
            return Response.json (
                {
                    game:
                    {
                        availableGameStats:
                        {
                            achievements: options.noAchievements ? [] :
                            [
                                {
                                    description: 'Complete the first test.',
                                    displayName: 'Unlocked Achievement',
                                    icon:        'https://cdn.example/unlocked.jpg',
                                    icongray:    'https://cdn.example/unlocked-gray.jpg',
                                    name:        'UNLOCKED',
                                },
                                {
                                    displayName: 'Hidden Achievement',
                                    name:        'LOCKED',
                                },
                            ],
                        },
                    },
                },
            );
        }

        if ( url.pathname.includes ( 'GetPlayerAchievements' ) )
        {
            return Response.json (
                {
                    playerstats:
                    {
                        achievements:
                        [
                            { achieved: 1, apiname: 'UNLOCKED', unlocktime: 1_780_000_000 },
                        ],
                        success: true,
                    },
                },
            );
        }

        if ( url.pathname.includes ( 'GetGameAchievements' ) )
        {
            if ( options.itemProgressUnavailable )
            {
                return new Response ( 'unavailable', { status: 503 } );
            }

            return Response.json (
                {
                    response:
                    {
                        achievements:
                        [
                            {
                                internal_key:    42,
                                internal_name:   'LOCKED',
                                max_progress_int: 10,
                                min_progress_int: 0,
                                progress_type:    1,
                            },
                        ],
                    },
                },
            );
        }

        if ( url.pathname.includes ( 'GetUserAchievements' ) )
        {
            if ( options.itemProgressUnavailable )
            {
                return new Response ( 'unavailable', { status: 503 } );
            }

            return Response.json (
                {
                    response:
                    {
                        achievements: [ { internal_key: 42, progress_int: 4 } ],
                    },
                },
            );
        }

        if ( url.pathname.includes ( 'GetGlobalAchievementPercentagesForApp' ) )
        {
            return options.rarityUnavailable
                ? new Response ( 'unavailable', { status: 503 } )
                : Response.json (
                    {
                        achievementpercentages:
                        {
                            achievements: [ { name: 'UNLOCKED', percent: '12.5' } ],
                        },
                    },
                );
        }

        throw new Error ( `Unexpected request: ${url.toString ()}` );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Merge and progress rules.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Selected-game achievement merge', () =>
{
    it ( 'performs a full unlocked merge by achievement API name', () =>
    {
        const definitions = createSchemaDefinitions ();
        const playerStates: PlayerAchievementState [] =
        [
            { achieved: true, apiName: 'UNLOCKED', unlockTime: 1_780_000_000 },
            { achieved: true, apiName: 'LOCKED', unlockTime: 1_780_000_100 },
        ];
        const achievements = mergeAchievements (
            definitions,
            playerStates,
            {
                achievements:
                [
                    { apiName: 'UNLOCKED', globalPercentage: 12.5 },
                    { apiName: 'LOCKED', globalPercentage: 50 },
                ],
            },
        );

        expect ( achievements ).toEqual (
            [
                {
                    achieved:        true,
                    apiName:         'UNLOCKED',
                    description:     'Complete the first test.',
                    globalPercentage: 12.5,
                    iconGrayUrl:     'https://cdn.example/unlocked-gray.jpg',
                    iconUrl:         'https://cdn.example/unlocked.jpg',
                    name:            'Unlocked Achievement',
                    progress:        null,
                    unlockTime:      1_780_000_000,
                },
                {
                    achieved:        true,
                    apiName:         'LOCKED',
                    description:     null,
                    globalPercentage: 50,
                    iconGrayUrl:     null,
                    iconUrl:         null,
                    name:            'Hidden Achievement',
                    progress:        null,
                    unlockTime:      1_780_000_100,
                },
            ],
        );
        expect ( calculateAchievementProgress ( achievements ) ).toEqual (
            { percentage: 100, total: 2, unlocked: 2 },
        );
    } );

    it ( 'keeps schema-only locked rows and normalizes missing rarity and unlock time', () =>
    {
        const achievements = mergeAchievements (
            createSchemaDefinitions (),
            [ { achieved: false, apiName: 'LOCKED', unlockTime: null } ],
            { achievements: [] },
        );

        expect ( achievements ).toEqual (
            [
                expect.objectContaining (
                    { achieved: false, apiName: 'UNLOCKED', globalPercentage: null, progress: null, unlockTime: null },
                ),
                expect.objectContaining (
                    { achieved: false, apiName: 'LOCKED', description: null, globalPercentage: null, progress: null, unlockTime: null },
                ),
            ],
        );
        expect ( calculateAchievementProgress ( achievements ) ).toEqual (
            { percentage: 0, total: 2, unlocked: 0 },
        );
    } );

    it ( 'merges Steam desktop-style current and target progress without using rarity', () =>
    {
        const achievements = mergeAchievements (
            createSchemaDefinitions (),
            [ { achieved: false, apiName: 'LOCKED', unlockTime: null } ],
            { achievements: [ { apiName: 'LOCKED', globalPercentage: 73.5 } ] },
            [ { apiName: 'LOCKED', internalKey: 42, minimum: 0, target: 10 } ],
            [ { current: 4, internalKey: 42 } ],
        );

        expect ( achievements [ 1 ]?.progress ).toEqual ( { current: 4, minimum: 0, target: 10 } );
        expect ( achievements [ 1 ]?.globalPercentage ).toBe ( 73.5 );
    } );
} );

//---------------------------------------------------------------------------------------------------------------------
// Aggregation, caching, and degradation.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Selected-game achievement aggregation', () =>
{
    it ( 'returns the complete normalized response and caches shared metadata only in KV', async () =>
    {
        const { cache, values } = createSharedCache ();
        const fetchFunction     = createAggregationFetch ( { rarityUnavailable: true } );
        const result            = await retrieveSelectedGameAchievements (
            STEAM_ID,
            620,
            `https://example.test/api/users/${STEAM_ID}/games/620/achievements`,
            'test-api-key',
            cache,
            fetchFunction,
            undefined,
        );

        expect ( result.game ).toEqual (
            {
                appId: 620,
                bannerUrls:
                [
                    'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_hero.jpg',
                    'https://cdn.example/header.jpg',
                ],
                iconUrl: GAME_ICON_URL,
                libraryLogoUrls:
                [
                    'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo_2x.png',
                    'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo.png',
                ],
                name: 'Portal 2 Store Name',
            },
        );
        expect ( result.progress ).toEqual ( { percentage: 50, total: 2, unlocked: 1 } );
        expect ( result.achievements ).toEqual (
            [
                expect.objectContaining (
                    { achieved: true, apiName: 'UNLOCKED', globalPercentage: null, progress: null, unlockTime: 1_780_000_000 },
                ),
                expect.objectContaining (
                    {
                        achieved: false,
                        apiName: 'LOCKED',
                        description: null,
                        globalPercentage: null,
                        progress: { current: 4, minimum: 0, target: 10 },
                        unlockTime: null,
                    },
                ),
            ],
        );
        expect ( values.has ( gameMetadataCacheKey ( 620 ) ) ).toBe ( true );
        expect ( values.has ( globalRarityCacheKey ( 620 ) ) ).toBe ( false );
        expect ( Array.from ( values.keys () ).some ( key => key.includes ( STEAM_ID ) ) ).toBe ( false );

        const persistentValues = Array.from ( values.values () ).map ( value => JSON.parse ( value ) as unknown );
        const persistentPropertyNames = persistentValues.reduce<Set<string>> (
            ( propertyNames, value ) => collectPropertyNames ( value, propertyNames ),
            new Set<string> (),
        );
        const persistentStrings = persistentValues.flatMap ( value => collectStringValues ( value ) );
        const persistentPropertyNameList = Array.from ( persistentPropertyNames );

        expect ( persistentPropertyNameList ).not.toContain ( 'achieved' );
        expect ( persistentPropertyNameList ).not.toContain ( 'current' );
        expect ( persistentPropertyNameList ).not.toContain ( 'personaName' );
        expect ( persistentPropertyNameList ).not.toContain ( 'playtimeMinutes' );
        expect ( persistentPropertyNameList ).not.toContain ( 'profileUrl' );
        expect ( persistentPropertyNameList ).not.toContain ( 'steamId' );
        expect ( persistentPropertyNameList ).not.toContain ( 'unlockTime' );
        expect ( persistentStrings.some ( value => /^(?:blob|data):/iu.test ( value ) ) ).toBe ( false );
    } );

    it ( 'rejects a schema with no achievements before loading player, rarity, or Store data', async () =>
    {
        const { cache }     = createSharedCache ();
        const fetchFunction = createAggregationFetch ( { noAchievements: true } );

        await expect ( retrieveSelectedGameAchievements (
            STEAM_ID,
            620,
            `https://example.test/api/users/${STEAM_ID}/games/620/achievements`,
            'test-api-key',
            cache,
            fetchFunction,
            undefined,
        ) ).rejects.toBeInstanceOf ( SteamGameHasNoAchievementsError );

        const requestedPaths = fetchFunction.mock.calls.map ( call =>
        {
            const input = call [ 0 ];

            return input instanceof URL ? input.pathname : new URL ( String ( input ) ).pathname;
        } );

        expect ( requestedPaths ).toEqual (
            [
                '/IPlayerService/GetOwnedGames/v1/',
                '/ISteamUserStats/GetSchemaForGame/v2/',
            ],
        );
    } );

    it ( 'degrades richer Steam item progress without failing the selected-game response', async () =>
    {
        const { cache }     = createSharedCache ();
        const fetchFunction = createAggregationFetch ( { itemProgressUnavailable: true } );
        const result        = await retrieveSelectedGameAchievements (
            STEAM_ID,
            620,
            `https://example.test/api/users/${STEAM_ID}/games/620/achievements`,
            'test-api-key',
            cache,
            fetchFunction,
            undefined,
        );

        expect ( result.achievements.every ( achievement => achievement.progress === null ) ).toBe ( true );
    } );

    it ( 'falls back to the library name and icon when Store artwork is unavailable', async () =>
    {
        const { cache }     = createSharedCache ();
        const fetchFunction = createAggregationFetch ( { storeUnavailable: true } );
        const result        = await retrieveSelectedGameAchievements (
            STEAM_ID,
            620,
            `https://example.test/api/users/${STEAM_ID}/games/620/achievements`,
            'test-api-key',
            cache,
            fetchFunction,
            undefined,
        );

        expect ( result.game ).toEqual (
            {
                appId:      620,
                bannerUrls: [ 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_hero.jpg' ],
                iconUrl:    GAME_ICON_URL,
                libraryLogoUrls:
                [
                    'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo_2x.png',
                    'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo.png',
                ],
                name: 'Portal 2',
            },
        );
    } );

    it ( 'reuses the short-lived edge response without repeating user or upstream requests', async () =>
    {
        const { cache: sharedCache, storage } = createSharedCache ();
        const { cache: edgeCache, put } = createEdgeCache ();
        const fetchFunction = createAggregationFetch ();
        const requestUrl    = `https://example.test/api/users/${STEAM_ID}/games/620/achievements`;

        const firstResult = await retrieveSelectedGameAchievements (
            STEAM_ID,
            620,
            requestUrl,
            'test-api-key',
            sharedCache,
            fetchFunction,
            edgeCache,
        );
        const fetchCountAfterFirstRequest = fetchFunction.mock.calls.length;
        const secondResult = await retrieveSelectedGameAchievements (
            STEAM_ID,
            620,
            requestUrl,
            'test-api-key',
            sharedCache,
            fetchFunction,
            edgeCache,
        );
        const selectedGameCacheWrite = put.mock.calls.find ( call =>
            ( call [ 0 ] as Request ).url.includes ( '/selected-game-achievements/' ) );

        expect ( secondResult ).toEqual ( firstResult );
        expect ( fetchFunction ).toHaveBeenCalledTimes ( fetchCountAfterFirstRequest );
        expect ( selectedGameCacheWrite ).toBeDefined ();
        expect ( ( selectedGameCacheWrite?.[ 1 ] as Response ).headers.get ( 'cache-control' ) )
            .toBe ( 'public, max-age=120' );
        expect ( storage.write ).toHaveBeenCalledWith (
            gameMetadataCacheKey ( 620 ),
            expect.any ( String ),
            86_400,
        );
        expect ( storage.write ).toHaveBeenCalledWith (
            globalRarityCacheKey ( 620 ),
            expect.any ( String ),
            21_600,
        );
    } );
} );
