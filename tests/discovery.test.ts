//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for cached capability reuse, cursor validation, playtime priority, and bounded progressive discovery.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { discoverGameAchievements } from '../src/api/discovery';
import { encodeDiscoveryCursor, GameDiscoveryCursorError } from '../src/api/discovery-cursor';
import { achievementCapabilityCacheKey } from '../src/cache/cache-keys';
import { SHARED_CACHE_TTL_SECONDS } from '../src/cache/cache-policy';
import { SharedCache, type SharedCacheStorage } from '../src/cache/cache';
import { isAchievementCapabilitySummary } from '../src/cache/game-achievements';
import type { AchievementCapabilitySummary, GameSummary } from '../src/model/api';

//---------------------------------------------------------------------------------------------------------------------
// Function: createGame
//
// Description:
//
//   Creates game from the supplied inputs.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - playtimeMinutes (number):
//   The playtime minutes used by the operation.
//
// Returns:
//
//   The resulting GameSummary value.
//
//---------------------------------------------------------------------------------------------------------------------

function createGame ( appId: number, playtimeMinutes = 0 ): GameSummary
{
    return (
        {
            achievementCapability: 'unknown',
            achievementCount:      null,
            appId,
            bannerUrl:             null,
            iconUrl:               null,
            name:                  `Game ${appId}`,
            playtimeMinutes,
        }
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

    return (
        { cache: new SharedCache ( storage ), storage, values }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSchemaResponse
//
// Description:
//
//   Creates schema response from the supplied inputs.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - hasAchievements (boolean):
//   The has achievements used by the operation.
//
// Returns:
//
//   The result produced by the create schema response operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createSchemaResponse ( appId: number, hasAchievements = true )
{
    return (
        {
            game:
            {
                availableGameStats:
                {
                    achievements: hasAchievements
                        ? [ { displayName: `Achievement ${appId}`, name: `ACHIEVEMENT_${appId}` } ]
                        : [],
                },
            },
        }
    );
}

describe ( 'Progressive game achievement discovery', () =>
{
    it ( 'processes a large library over bounded batches of at most twenty schema requests', async () =>
    {
        const games         = Array.from ( { length: 45 }, ( _value, index ) => createGame ( index + 1 ) );
        const { cache }     = createSharedCache ();
        const fetchFunction = vi.fn ( async ( input: RequestInfo | URL ) =>
        {
            const url   = input instanceof URL ? input : new URL ( String ( input ) );
            const appId = Number ( url.searchParams.get ( 'appid' ) );

            return Response.json ( createSchemaResponse ( appId ) );
        } );
        const batchSizes: number [] = [];
        const discoveredAppIds: number [] = [];
        let cursor: string | null = encodeDiscoveryCursor ( 0 );

        while ( cursor !== null )
        {
            const fetchCountBefore = fetchFunction.mock.calls.length;
            const discovery        = await discoverGameAchievements (
                games,
                cursor,
                cache,
                'test-api-key',
                fetchFunction,
            );

            batchSizes.push ( fetchFunction.mock.calls.length - fetchCountBefore );
            discoveredAppIds.push ( ...discovery.games.map ( game => game.appId ) );
            cursor = discovery.discoveryCursor;
        }

        expect ( batchSizes ).toEqual ( [ 20, 20, 5 ] );
        expect ( discoveredAppIds ).toHaveLength ( 45 );
        expect ( new Set ( discoveredAppIds ).size ).toBe ( 45 );
    } );

    it ( 'reuses cached yes and no capabilities without contacting Steam', async () =>
    {
        const { cache } = createSharedCache ();

        await cache.write (
            achievementCapabilityCacheKey ( 1 ),
            { achievementCount: 4, hasAchievements: true },
            SHARED_CACHE_TTL_SECONDS.achievementCapability,
        );
        await cache.write (
            achievementCapabilityCacheKey ( 2 ),
            { achievementCount: 0, hasAchievements: false },
            SHARED_CACHE_TTL_SECONDS.achievementCapability,
        );

        const fetchFunction = vi.fn ();
        const discovery     = await discoverGameAchievements (
            [ createGame ( 1 ), createGame ( 2 ) ],
            encodeDiscoveryCursor ( 0 ),
            cache,
            'test-api-key',
            fetchFunction,
        );

        expect ( discovery.games ).toEqual ( [ expect.objectContaining ( { appId: 1, achievementCount: 4 } ) ] );
        expect ( fetchFunction ).not.toHaveBeenCalled ();
    } );

    it ( 'caches both the normalized schema and capability result for an unknown game', async () =>
    {
        const { cache }     = createSharedCache ();
        const fetchFunction = vi.fn ( async () => Response.json ( createSchemaResponse ( 620 ) ) );

        await discoverGameAchievements (
            [ createGame ( 620 ) ],
            encodeDiscoveryCursor ( 0 ),
            cache,
            'test-api-key',
            fetchFunction,
        );

        const capability = await cache.read<AchievementCapabilitySummary> (
            achievementCapabilityCacheKey ( 620 ),
            isAchievementCapabilitySummary,
        );

        expect ( capability ).toEqual ( { achievementCount: 1, hasAchievements: true } );
        expect ( fetchFunction ).toHaveBeenCalledTimes ( 1 );
    } );

    it ( 'continues with uncached discovery when every KV write is rejected', async () =>
    {
        const storage =
        {
            read:  vi.fn ( async () => null ),
            write: vi.fn ( async () => Promise.reject ( new Error ( 'KV write quota exhausted' ) ) ),
        } satisfies SharedCacheStorage;
        const cache         = new SharedCache ( storage );
        const fetchFunction = vi.fn ( async () => Response.json ( createSchemaResponse ( 620 ) ) );

        const firstDiscovery = await discoverGameAchievements (
            [ createGame ( 620 ) ],
            encodeDiscoveryCursor ( 0 ),
            cache,
            'test-api-key',
            fetchFunction,
        );
        const secondDiscovery = await discoverGameAchievements (
            [ createGame ( 620 ) ],
            encodeDiscoveryCursor ( 0 ),
            cache,
            'test-api-key',
            fetchFunction,
        );

        expect ( firstDiscovery.games ).toEqual ( [ expect.objectContaining ( { appId: 620 } ) ] );
        expect ( secondDiscovery.games ).toEqual ( [ expect.objectContaining ( { appId: 620 } ) ] );
        expect ( fetchFunction ).toHaveBeenCalledTimes ( 2 );
        expect ( storage.write ).toHaveBeenCalledTimes ( 4 );
    } );

    it ( 'prioritizes played games by descending playtime', async () =>
    {
        const { cache }     = createSharedCache ();
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL ) =>
            Response.json ( createSchemaResponse ( 3 ) ) );

        await discoverGameAchievements (
            [ createGame ( 1, 0 ), createGame ( 2, 30 ), createGame ( 3, 90 ) ],
            encodeDiscoveryCursor ( 0 ),
            cache,
            'test-api-key',
            fetchFunction,
            1,
        );

        const url = fetchFunction.mock.calls [ 0 ]?.[ 0 ];

        expect ( url ).toBeInstanceOf ( URL );

        if ( ! ( url instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam adapter to call fetch with a URL.' );
        }

        expect ( url.searchParams.get ( 'appid' ) ).toBe ( '3' );
    } );

    it ( 'omits a game whose normalized schema contains no achievements', async () =>
    {
        const { cache }     = createSharedCache ();
        const fetchFunction = vi.fn ( async () => Response.json ( createSchemaResponse ( 620, false ) ) );
        const discovery     = await discoverGameAchievements (
            [ createGame ( 620 ) ],
            encodeDiscoveryCursor ( 0 ),
            cache,
            'test-api-key',
            fetchFunction,
        );

        expect ( discovery.games ).toEqual ( [] );
        expect ( discovery.discoveryCursor ).toBeNull ();
    } );

    it ( 'rejects malformed and out-of-range cursors', async () =>
    {
        const { cache } = createSharedCache ();

        await expect ( discoverGameAchievements (
            [ createGame ( 1 ) ],
            'not-a-valid-cursor',
            cache,
            'test-api-key',
        ) ).rejects.toBeInstanceOf ( GameDiscoveryCursorError );
        await expect ( discoverGameAchievements (
            [ createGame ( 1 ) ],
            encodeDiscoveryCursor ( 2 ),
            cache,
            'test-api-key',
        ) ).rejects.toBeInstanceOf ( GameDiscoveryCursorError );
    } );
} );
