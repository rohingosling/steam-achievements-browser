//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Workers KV storage adapter for the typed shared-cache layer. Feature modules receive SharedCache rather than a KV
//   namespace, keeping storage APIs and platform-specific write options out of route and Steam-adapter code.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import type { KeyValueNamespaceBinding } from '../environment';
import { SharedCache, type SharedCacheInstrumentation, type SharedCacheStorage } from './cache';

//---------------------------------------------------------------------------------------------------------------------
// KV storage adapter.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: KeyValueCacheStorage
//
// Description:
//
//   Encapsulates key value cache storage behavior and the state required by its operations.
//
//---------------------------------------------------------------------------------------------------------------------

export class KeyValueCacheStorage implements SharedCacheStorage
{
    readonly #namespace: KeyValueNamespaceBinding;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a KeyValueCacheStorage instance with the supplied dependencies and state.
    //
    // Parameters:
    //
    // - namespace (KeyValueNamespaceBinding):
    //   The Workers KV namespace backing the shared cache.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ( namespace: KeyValueNamespaceBinding )
    {
        this.#namespace = namespace;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: read
    //
    // Description:
    //
    //   Reads one serialized shared-cache value from Workers KV.
    //
    // Parameters:
    //
    // - key (string):
    //   The cache or protocol key identifying the value.
    //
    // Returns:
    //
    //   The resulting Promise<string | null> value.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public async read ( key: string ): Promise<string | null>
    {
        return this.#namespace.get ( key );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: write
    //
    // Description:
    //
    //   Writes one serialized shared-cache value to Workers KV with its expiration policy.
    //
    // Parameters:
    //
    // - key (string):
    //   The cache or protocol key identifying the value.
    //
    // - value (string):
    //   The untrusted value to validate or normalize.
    //
    // - timeToLiveSeconds (number):
    //   The cache lifetime in seconds.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public async write ( key: string, value: string, timeToLiveSeconds: number ): Promise<void>
    {
        await this.#namespace.put ( key, value, { expirationTtl: timeToLiveSeconds } );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Runtime instrumentation and cache factory.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: recordSharedCacheEvent
//
// Description:
//
//   Writes shared cache event without exposing implementation details to callers.
//
// Parameters:
//
// - event (unknown):
//   The event used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export const recordSharedCacheEvent: SharedCacheInstrumentation = event =>
{
    console.info ( JSON.stringify (
        {
            cache:                'shared-game-metadata',
            key:                  event.key,
            outcome:              event.type,
            serializedByteLength: event.serializedByteLength,
            timeToLiveSeconds:    event.timeToLiveSeconds,
        },
    ) );
};

//---------------------------------------------------------------------------------------------------------------------
// Function: createSharedCache
//
// Description:
//
//   Creates shared cache from the supplied inputs.
//
// Parameters:
//
// - namespace (KeyValueNamespaceBinding):
//   The Workers KV namespace backing the shared cache.
//
// - instrumentation (SharedCacheInstrumentation):
//   The instrumentation used by the operation.
//
// Returns:
//
//   The resulting SharedCache value.
//
//---------------------------------------------------------------------------------------------------------------------

export function createSharedCache
(
    namespace: KeyValueNamespaceBinding,
    instrumentation: SharedCacheInstrumentation = recordSharedCacheEvent,
): SharedCache
{
    return new SharedCache ( new KeyValueCacheStorage ( namespace ), { instrumentation } );
}
