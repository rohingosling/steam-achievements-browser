//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Typed read-through cache orchestration for shared, normalized Steam metadata. Cached payloads cross a validation
//   boundary before use, expired or corrupt values are refreshed, and storage failures never replace successful live
//   loader results with application errors.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

export interface SharedCacheStorage
{
    read ( key: string ): Promise<string | null>;
    write ( key: string, value: string, timeToLiveSeconds: number ): Promise<void>;
}

export type CacheValueValidator<Value> = ( value: unknown ) => value is Value;

export type SharedCacheEventType =
    'corrupt'
    | 'hit'
    | 'miss'
    | 'read-failure'
    | 'stale'
    | 'write'
    | 'write-failure';

export interface SharedCacheEvent
{
    key: string;
    serializedByteLength?: number;
    timeToLiveSeconds?: number;
    type: SharedCacheEventType;
}

export type SharedCacheInstrumentation = ( event: SharedCacheEvent ) => void;

export interface SharedCacheOptions
{
    instrumentation?: SharedCacheInstrumentation;
    now?: () => number;
}

export interface SharedCacheLoadOptions<Value>
{
    key: string;
    loader: () => Promise<Value>;
    timeToLiveSeconds: number;
    validate: CacheValueValidator<Value>;
}

interface CacheEnvelope
{
    expiresAt: number;
    value: unknown;
}

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const UTF8_ENCODER = new TextEncoder ();

//---------------------------------------------------------------------------------------------------------------------
// Validation helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isJsonObject
//
// Description:
//
//   Determines whether the supplied value satisfies the JSON object contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the JSON object contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isJsonObject ( value: unknown ): value is Record<string, unknown>
{
    return typeof value === 'object' && value !== null && !Array.isArray ( value );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: parseEnvelope
//
// Description:
//
//   Parses envelope from its serialized or user-provided representation.
//
// Parameters:
//
// - serializedValue (string):
//   The serialized value used by the operation.
//
// Returns:
//
//   The resulting CacheEnvelope | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function parseEnvelope ( serializedValue: string ): CacheEnvelope | null
{
    try
    {
        const value = JSON.parse ( serializedValue ) as unknown;

        if ( !isJsonObject ( value ) || typeof value.expiresAt !== 'number' || !Number.isFinite ( value.expiresAt ) )
        {
            return null;
        }

        return (
            {
                expiresAt: value.expiresAt,
                value:     value.value,
            }
        );
    }
    catch
    {
        return null;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: requireValidTimeToLive
//
// Description:
//
//   Validates time to live and returns the accepted value or throws a safe boundary error.
//
// Parameters:
//
// - timeToLiveSeconds (number):
//   The cache lifetime in seconds.
//
// Returns:
//
//   The resulting number value.
//
//---------------------------------------------------------------------------------------------------------------------

function requireValidTimeToLive ( timeToLiveSeconds: number ): number
{
    if ( !Number.isSafeInteger ( timeToLiveSeconds ) || timeToLiveSeconds < 1 )
    {
        throw new RangeError ( 'A positive whole-number cache TTL is required.' );
    }

    return timeToLiveSeconds;
}

//---------------------------------------------------------------------------------------------------------------------
// Typed shared cache.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: SharedCache
//
// Description:
//
//   Encapsulates shared cache behavior and the state required by its operations.
//
//---------------------------------------------------------------------------------------------------------------------

export class SharedCache
{
    readonly #instrumentation: SharedCacheInstrumentation;
    readonly #now: () => number;
    readonly #storage: SharedCacheStorage;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SharedCache instance with the supplied dependencies and state.
    //
    // Parameters:
    //
    // - storage (SharedCacheStorage):
    //   The storage adapter backing the shared cache.
    //
    // - options (SharedCacheOptions):
    //   Optional dependencies and policy overrides for the operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ( storage: SharedCacheStorage, options: SharedCacheOptions = {} )
    {
        this.#instrumentation = options.instrumentation ?? ( () => undefined );
        this.#now             = options.now ?? Date.now;
        this.#storage         = storage;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: read
    //
    // Description:
    //
    //   Reads and validates a fresh shared-cache value while treating storage failures as misses.
    //
    // Parameters:
    //
    // - key (string):
    //   The cache or protocol key identifying the value.
    //
    // - validate (CacheValueValidator<Value>):
    //   The validate used by the operation.
    //
    // Returns:
    //
    //   The resulting Promise<Value | null> value.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public async read<Value> ( key: string, validate: CacheValueValidator<Value> ): Promise<Value | null>
    {
        let serializedValue: string | null;

        try
        {
            // Treat unavailable shared storage as a cache miss so live Steam data can still satisfy the request.

            serializedValue = await this.#storage.read ( key );
        }
        catch
        {
            this.#record ( { key, type: 'read-failure' } );

            return null;
        }

        if ( serializedValue === null )
        {
            this.#record ( { key, type: 'miss' } );

            return null;
        }

        const envelope = parseEnvelope ( serializedValue );

        // Reject corrupt or schema-incompatible entries before their values can cross the cache boundary.

        if ( envelope === null || !validate ( envelope.value ) )
        {
            this.#record (
                {
                    key,
                    serializedByteLength: UTF8_ENCODER.encode ( serializedValue ).byteLength,
                    type:                 'corrupt',
                },
            );

            return null;
        }

        // Expired entries are observable as stale but never served to callers.

        if ( envelope.expiresAt <= this.#now () )
        {
            this.#record (
                {
                    key,
                    serializedByteLength: UTF8_ENCODER.encode ( serializedValue ).byteLength,
                    type:                 'stale',
                },
            );

            return null;
        }

        this.#record (
            {
                key,
                serializedByteLength: UTF8_ENCODER.encode ( serializedValue ).byteLength,
                type:                 'hit',
            },
        );

        return envelope.value;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: write
    //
    // Description:
    //
    //   Serializes and writes a shared-cache value without allowing write failures to fail the request.
    //
    // Parameters:
    //
    // - key (string):
    //   The cache or protocol key identifying the value.
    //
    // - value (Value):
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

    public async write<Value> ( key: string, value: Value, timeToLiveSeconds: number ): Promise<void>
    {
        const validatedTimeToLiveSeconds = requireValidTimeToLive ( timeToLiveSeconds );
        let serializedByteLength: number | undefined;

        try
        {
            // Store a compact versioned envelope so freshness can be enforced independently of KV expiration.

            const serializedValue = JSON.stringify (
                {
                    expiresAt: this.#now () + validatedTimeToLiveSeconds * 1_000,
                    value,
                },
            );
            serializedByteLength = UTF8_ENCODER.encode ( serializedValue ).byteLength;

            await this.#storage.write ( key, serializedValue, validatedTimeToLiveSeconds );
            this.#record (
                {
                    key,
                    serializedByteLength,
                    timeToLiveSeconds: validatedTimeToLiveSeconds,
                    type:              'write',
                },
            );
        }
        catch
        {
            // Cache writes are best-effort and must not turn a successful live request into an application failure.

            this.#record (
                {
                    key,
                    serializedByteLength,
                    timeToLiveSeconds: validatedTimeToLiveSeconds,
                    type:              'write-failure',
                },
            );
        }
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: getOrLoad
    //
    // Description:
    //
    //   Returns a valid cached value or loads and best-effort caches a fresh replacement.
    //
    // Parameters:
    //
    // - options (SharedCacheLoadOptions<Value>):
    //   Optional dependencies and policy overrides for the operation.
    //
    // Returns:
    //
    //   The resulting Promise<Value> value.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public async getOrLoad<Value> ( options: SharedCacheLoadOptions<Value> ): Promise<Value>
    {
        const cachedValue = await this.read ( options.key, options.validate );

        // A validated cache hit bypasses both the upstream loader and the best-effort write path.

        if ( cachedValue !== null )
        {
            return cachedValue;
        }

        const loadedValue = await options.loader ();

        await this.write ( options.key, loadedValue, options.timeToLiveSeconds );

        return loadedValue;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: #record
    //
    // Description:
    //
    //   Records a cache instrumentation event without allowing observer failures to affect the request.
    //
    // Parameters:
    //
    // - event (SharedCacheEvent):
    //   The event used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    #record ( event: SharedCacheEvent ): void
    {
        try
        {
            this.#instrumentation ( event );
        }
        catch
        {
            // Cache instrumentation must never alter request behavior.
        }
    }
}
