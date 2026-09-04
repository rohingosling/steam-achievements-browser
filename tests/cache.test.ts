//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for shared-cache key families, TTL policy, validation, read-through loading, stale/corrupt refreshes,
//   best-effort writes, and cache instrumentation.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { SharedCache, type SharedCacheEvent, type SharedCacheStorage } from '../src/cache/cache';
import {
    achievementCapabilityCacheKey,
    achievementItemProgressSchemaCacheKey,
    achievementSchemaCacheKey,
    gameMetadataCacheKey,
    globalRarityCacheKey,
    SHARED_CACHE_OBJECT_VERSION,
} from '../src/cache/cache-keys';
import { EDGE_CACHE_TTL_SECONDS, SHARED_CACHE_TTL_SECONDS } from '../src/cache/cache-policy';
import { KeyValueCacheStorage, recordSharedCacheEvent } from '../src/cache/kv-cache';

//---------------------------------------------------------------------------------------------------------------------
// Test helpers.
//---------------------------------------------------------------------------------------------------------------------

interface ExampleValue
{
    name: string;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isExampleValue
//
// Description:
//
//   Determines whether the supplied value satisfies the example value contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the example value contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isExampleValue ( value: unknown ): value is ExampleValue
{
    return typeof value === 'object'
        && value !== null
        && !Array.isArray ( value )
        && typeof ( value as Record<string, unknown> ).name === 'string';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createMemoryStorage
//
// Description:
//
//   Creates memory storage from the supplied inputs.
//
// Parameters:
//
// - initialValues (ReadonlyMap<string, string>):
//   The initial values used by the operation.
//
// Returns:
//
//   The result produced by the create memory storage operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createMemoryStorage ( initialValues: ReadonlyMap<string, string> = new Map () )
{
    const values = new Map ( initialValues );
    const read   = vi.fn ( async ( key: string ) => values.get ( key ) ?? null );
    const write  = vi.fn ( async ( key: string, value: string, _timeToLiveSeconds: number ) =>
    {
        values.set ( key, value );
    } );
    const storage = { read, write } satisfies SharedCacheStorage;

    return (
        { read, storage, values, write }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createInstrumentedCache
//
// Description:
//
//   Creates instrumented cache from the supplied inputs.
//
// Parameters:
//
// - storage (SharedCacheStorage):
//   The storage adapter backing the shared cache.
//
// - now (number):
//   The now used by the operation.
//
// Returns:
//
//   The result produced by the create instrumented cache operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createInstrumentedCache ( storage: SharedCacheStorage, now = 1_000_000 )
{
    const events: SharedCacheEvent [] = [];
    const cache = new SharedCache (
        storage,
        {
            instrumentation: event => events.push ( event ),
            now: () => now,
        },
    );

    return (
        { cache, events }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Key and policy definitions.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Shared-cache keys and policy', () =>
{
    it ( 'constructs every versioned AppID key family', () =>
    {
        expect ( gameMetadataCacheKey ( 620 ) ).toBe ( 'game:v2:620:meta' );
        expect ( achievementCapabilityCacheKey ( 620 ) ).toBe ( 'game:v1:620:achievement-capability' );
        expect ( achievementItemProgressSchemaCacheKey ( 620 ) ).toBe ( 'game:v1:620:item-progress-schema:en' );
        expect ( achievementSchemaCacheKey ( 620 ) ).toBe ( 'game:v1:620:schema:en' );
        expect ( globalRarityCacheKey ( 620 ) ).toBe ( 'game:v2:620:rarity' );
    } );

    it ( 'exposes one auditable object version for every shared key family', () =>
    {
        expect ( SHARED_CACHE_OBJECT_VERSION ).toEqual (
            {
                achievementCapability:         1,
                achievementItemProgressSchema: 1,
                achievementSchema:             1,
                gameMetadata:                  2,
                globalRarity:                  2,
            },
        );
    } );

    it ( 'rejects invalid AppIDs before key construction', () =>
    {
        expect ( () => gameMetadataCacheKey ( 0 ) ).toThrow ( RangeError );
        expect ( () => gameMetadataCacheKey ( Number.NaN ) ).toThrow ( RangeError );
        expect ( () => gameMetadataCacheKey ( 4_294_967_296 ) ).toThrow ( RangeError );
    } );

    it ( 'centralizes every documented shared and edge-cache TTL', () =>
    {
        expect ( EDGE_CACHE_TTL_SECONDS ).toEqual (
            {
                selectedGameAchievements: 120,
                userLibrary:              300,
                userProfile:              600,
            },
        );
        expect ( SHARED_CACHE_TTL_SECONDS ).toEqual (
            {
                achievementCapability: 2_592_000,
                achievementItemProgressSchema: 2_592_000,
                achievementSchema:     2_592_000,
                gameMetadata:          86_400,
                globalRarity:          21_600,
            },
        );
    } );
} );

//---------------------------------------------------------------------------------------------------------------------
// Typed read-through behavior.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Shared cache', () =>
{
    it ( 'returns a valid cache hit without invoking the loader', async () =>
    {
        const key               = gameMetadataCacheKey ( 620 );
        const serializedValue   = JSON.stringify ( { expiresAt: 1_001_000, value: { name: 'Portal 2' } } );
        const { storage }       = createMemoryStorage ( new Map ( [ [ key, serializedValue ] ] ) );
        const { cache, events } = createInstrumentedCache ( storage );
        const loader            = vi.fn ( async () => ( { name: 'Live Portal 2' } ) );

        await expect ( cache.getOrLoad (
            {
                key,
                loader,
                timeToLiveSeconds: 86_400,
                validate:              isExampleValue,
            },
        ) ).resolves.toEqual ( { name: 'Portal 2' } );
        expect ( loader ).not.toHaveBeenCalled ();
        expect ( events ).toEqual (
            [
                {
                    key,
                    serializedByteLength: new TextEncoder ().encode ( serializedValue ).byteLength,
                    type:                 'hit',
                },
            ],
        );
    } );

    it ( 'loads and writes a cache miss with the requested TTL', async () =>
    {
        const key                        = gameMetadataCacheKey ( 620 );
        const { storage, values, write } = createMemoryStorage ();
        const { cache, events }          = createInstrumentedCache ( storage );
        const loader                     = vi.fn ( async () => ( { name: 'Portal 2' } ) );

        await expect ( cache.getOrLoad (
            {
                key,
                loader,
                timeToLiveSeconds: 86_400,
                validate:              isExampleValue,
            },
        ) ).resolves.toEqual ( { name: 'Portal 2' } );
        expect ( loader ).toHaveBeenCalledTimes ( 1 );
        expect ( write ).toHaveBeenCalledWith ( key, expect.any ( String ), 86_400 );
        expect ( JSON.parse ( values.get ( key ) ?? '' ) ).toEqual (
            {
                expiresAt: 87_400_000,
                value:     { name: 'Portal 2' },
            },
        );
        expect ( events ).toEqual (
            [
                { key, type: 'miss' },
                {
                    key,
                    serializedByteLength: new TextEncoder ().encode ( values.get ( key ) ?? '' ).byteLength,
                    timeToLiveSeconds:    86_400,
                    type:                 'write',
                },
            ],
        );
    } );

    it ( 'refreshes a stale value', async () =>
    {
        const key               = gameMetadataCacheKey ( 620 );
        const serializedValue   = JSON.stringify ( { expiresAt: 999_999, value: { name: 'Old' } } );
        const { storage }       = createMemoryStorage ( new Map ( [ [ key, serializedValue ] ] ) );
        const { cache, events } = createInstrumentedCache ( storage );
        const loader            = vi.fn ( async () => ( { name: 'Fresh' } ) );

        await expect ( cache.getOrLoad (
            {
                key,
                loader,
                timeToLiveSeconds: 86_400,
                validate:              isExampleValue,
            },
        ) ).resolves.toEqual ( { name: 'Fresh' } );
        expect ( loader ).toHaveBeenCalledTimes ( 1 );
        expect ( events.map ( event => event.type ) ).toEqual ( [ 'stale', 'write' ] );
    } );

    it.each (
        [
            [ 'malformed JSON', '{not-json' ],
            [ 'invalid envelope', JSON.stringify ( { value: { name: 'Old' } } ) ],
            [ 'invalid typed payload', JSON.stringify ( { expiresAt: 1_001_000, value: { title: 'Old' } } ) ],
        ],
    ) ( 'discards and refreshes %s', async ( _description, serializedValue ) =>
    {
        const key                 = gameMetadataCacheKey ( 620 );
        const { storage, values } = createMemoryStorage ( new Map ( [ [ key, serializedValue ] ] ) );
        const { cache, events }   = createInstrumentedCache ( storage );

        await expect ( cache.getOrLoad (
            {
                key,
                loader:                async () => ( { name: 'Fresh' } ),
                timeToLiveSeconds: 86_400,
                validate:              isExampleValue,
            },
        ) ).resolves.toEqual ( { name: 'Fresh' } );
        expect ( JSON.parse ( values.get ( key ) ?? '' ).value ).toEqual ( { name: 'Fresh' } );
        expect ( events.map ( event => event.type ) ).toEqual ( [ 'corrupt', 'write' ] );
    } );

    it ( 'returns a successful loader result when the cache write fails', async () =>
    {
        const key     = gameMetadataCacheKey ( 620 );
        const storage =
        {
            read:  vi.fn ( async () => null ),
            write: vi.fn ( async () => Promise.reject ( new Error ( 'KV quota exhausted' ) ) ),
        } satisfies SharedCacheStorage;
        const { cache, events } = createInstrumentedCache ( storage );

        await expect ( cache.getOrLoad (
            {
                key,
                loader:                async () => ( { name: 'Portal 2' } ),
                timeToLiveSeconds: 86_400,
                validate:              isExampleValue,
            },
        ) ).resolves.toEqual ( { name: 'Portal 2' } );
        expect ( events.map ( event => event.type ) ).toEqual ( [ 'miss', 'write-failure' ] );
        expect ( events [ 1 ] ).toEqual (
            expect.objectContaining (
                {
                    serializedByteLength: expect.any ( Number ),
                    timeToLiveSeconds:    86_400,
                },
            ),
        );
    } );

    it ( 'loads live data when the cache read fails', async () =>
    {
        const key     = gameMetadataCacheKey ( 620 );
        const storage =
        {
            read:  vi.fn ( async () => Promise.reject ( new Error ( 'KV unavailable' ) ) ),
            write: vi.fn ( async () => undefined ),
        } satisfies SharedCacheStorage;
        const { cache, events } = createInstrumentedCache ( storage );

        await expect ( cache.getOrLoad (
            {
                key,
                loader:                async () => ( { name: 'Portal 2' } ),
                timeToLiveSeconds: 86_400,
                validate:              isExampleValue,
            },
        ) ).resolves.toEqual ( { name: 'Portal 2' } );
        expect ( events.map ( event => event.type ) ).toEqual ( [ 'read-failure', 'write' ] );
    } );

    it ( 'does not let instrumentation failures alter cache behavior', async () =>
    {
        const { storage } = createMemoryStorage ();
        const cache       = new SharedCache (
            storage,
            {
                instrumentation: () =>
                {
                    throw new Error ( 'metrics unavailable' );
                },
            },
        );

        await expect ( cache.getOrLoad (
            {
                key:                   gameMetadataCacheKey ( 620 ),
                loader:                async () => ( { name: 'Portal 2' } ),
                timeToLiveSeconds: 86_400,
                validate:              isExampleValue,
            },
        ) ).resolves.toEqual ( { name: 'Portal 2' } );
    } );

    it ( 'rejects invalid TTL values before writing', async () =>
    {
        const { storage } = createMemoryStorage ();
        const cache       = new SharedCache ( storage );

        await expect ( cache.write ( 'key', { name: 'Portal 2' }, 0 ) ).rejects.toThrow ( RangeError );
    } );
} );

//---------------------------------------------------------------------------------------------------------------------
// Workers KV adapter.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Workers KV cache storage', () =>
{
    it ( 'maps generic reads and TTL writes to the namespace binding', async () =>
    {
        const namespace =
        {
            get: vi.fn ( async () => 'cached-value' ),
            put: vi.fn ( async () => undefined ),
        };
        const storage = new KeyValueCacheStorage ( namespace );

        await expect ( storage.read ( 'cache-key' ) ).resolves.toBe ( 'cached-value' );
        await storage.write ( 'cache-key', 'next-value', 60 );

        expect ( namespace.get ).toHaveBeenCalledWith ( 'cache-key' );
        expect ( namespace.put ).toHaveBeenCalledWith ( 'cache-key', 'next-value', { expirationTtl: 60 } );
    } );

    it ( 'logs compact capacity metadata without serializing the cached payload', () =>
    {
        const consoleInfo = vi.spyOn ( console, 'info' ).mockImplementation ( () => undefined );

        recordSharedCacheEvent (
            {
                key:                  gameMetadataCacheKey ( 620 ),
                serializedByteLength: 1_024,
                timeToLiveSeconds:    86_400,
                type:                 'write',
            },
        );

        expect ( consoleInfo ).toHaveBeenCalledTimes ( 1 );
        expect ( JSON.parse ( String ( consoleInfo.mock.calls [ 0 ]?.[ 0 ] ) ) ).toEqual (
            {
                cache:                'shared-game-metadata',
                key:                  'game:v2:620:meta',
                outcome:              'write',
                serializedByteLength: 1_024,
                timeToLiveSeconds:    86_400,
            },
        );

        consoleInfo.mockRestore ();
    } );
} );
