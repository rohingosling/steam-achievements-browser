//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-01
// Author:  Rohin Gosling
//
// Description:
//
//   Selected-game achievement aggregation and edge-only caching. Shared schema, rarity, and display metadata are
//   merged with live player state into the normalized response consumed by the frontend in later phases.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import {
    loadAchievementItemProgressSchema,
    loadAchievementSchema,
    loadGlobalAchievementRarity,
} from '../cache/game-achievements';
import { EDGE_CACHE_TTL_SECONDS } from '../cache/cache-policy';
import { loadGameMetadata } from '../cache/game-metadata';
import { SharedCache } from '../cache/cache';
import type {
    Achievement,
    AchievementDefinition,
    AchievementItemProgress,
    AchievementItemProgressDefinition,
    AchievementProgress,
    GlobalAchievementRarity,
    PlayerAchievementItemProgress,
    PlayerAchievementState,
    SelectedGameAchievements,
} from '../model/api';
import {
    getPlayerAchievementItemProgress,
    getPlayerAchievements,
    validateAppId,
} from '../steam/achievements';
import { validateSteamId } from '../steam/library';
import { retrieveVisibleLibraryGames } from './games';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const BAD_REQUEST           = 400;
const CACHE_KEY_PATH_PREFIX = '/__edge-cache/selected-game-achievements/v1/';
const JSON_CONTENT_TYPE     = 'application/json; charset=utf-8';
const NOT_FOUND             = 404;

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

interface DefaultCacheStorage
{
    default?: Cache;
}

export type SelectedGameAchievementsErrorCode =
    'STEAM_APP_ID_INVALID'
    | 'STEAM_GAME_HAS_NO_ACHIEVEMENTS'
    | 'STEAM_GAME_NOT_VISIBLE';

//---------------------------------------------------------------------------------------------------------------------
// Normalized errors.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: SelectedGameAchievementsError
//
// Description:
//
//   Represents a normalized selected game achievements failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SelectedGameAchievementsError extends Error
{
    public readonly code: SelectedGameAchievementsErrorCode;
    public readonly status: number;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SelectedGameAchievementsError instance with the supplied dependencies and state.
    //
    // Parameters:
    //
    // - code (SelectedGameAchievementsErrorCode):
    //   The normalized machine-readable error code.
    //
    // - message (string):
    //   The human-readable status or error message.
    //
    // - status (number):
    //   The safe HTTP status associated with the normalized error.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ( code: SelectedGameAchievementsErrorCode, message: string, status: number )
    {
        super ( message );

        this.name   = 'SelectedGameAchievementsError';
        this.code   = code;
        this.status = status;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: InvalidAppIdError
//
// Description:
//
//   Represents a normalized invalid APPID failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class InvalidAppIdError extends SelectedGameAchievementsError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes an InvalidAppIdError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super ( 'STEAM_APP_ID_INVALID', 'The Steam AppID is invalid.', BAD_REQUEST );

        this.name = 'InvalidAppIdError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamGameNotVisibleError
//
// Description:
//
//   Represents a normalized steam game not visible failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamGameNotVisibleError extends SelectedGameAchievementsError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamGameNotVisibleError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super ( 'STEAM_GAME_NOT_VISIBLE', 'The selected game is not visible in this Steam library.', NOT_FOUND );

        this.name = 'SteamGameNotVisibleError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamGameHasNoAchievementsError
//
// Description:
//
//   Represents a normalized steam game has no achievements failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamGameHasNoAchievementsError extends SelectedGameAchievementsError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamGameHasNoAchievementsError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_GAME_HAS_NO_ACHIEVEMENTS',
            'The selected game does not expose Steam achievements.',
            NOT_FOUND,
        );

        this.name = 'SteamGameHasNoAchievementsError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Edge-cache helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: getDefaultEdgeCache
//
// Description:
//
//   Retrieves default edge cache through the appropriate application boundary.
//
// Returns:
//
//   The resulting Cache | undefined value.
//
//---------------------------------------------------------------------------------------------------------------------

function getDefaultEdgeCache (): Cache | undefined
{
    const cacheStorage = ( globalThis as typeof globalThis & { caches?: DefaultCacheStorage } ).caches;

    return cacheStorage?.default;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createCacheRequest
//
// Description:
//
//   Creates cache request from the supplied inputs.
//
// Parameters:
//
// - requestUrl (string):
//   The original request URL used to construct the cache key.
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting Request value.
//
//---------------------------------------------------------------------------------------------------------------------

function createCacheRequest ( requestUrl: string, steamId: string, appId: number ): Request
{
    const cacheUrl = new URL ( `${CACHE_KEY_PATH_PREFIX}${steamId}/${appId}`, requestUrl );

    cacheUrl.search = '';
    cacheUrl.hash   = '';

    return new Request ( cacheUrl, { method: 'GET' } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNullableString
//
// Description:
//
//   Determines whether the supplied value satisfies the nullable string contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the nullable string contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNullableString ( value: unknown ): value is string | null
{
    return value === null || typeof value === 'string';
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNormalizedItemProgress
//
// Description:
//
//   Determines whether the supplied value satisfies the normalized item progress contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the normalized item progress contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNormalizedItemProgress ( value: unknown ): value is AchievementItemProgress | null
{
    if ( value === null )
    {
        return true;
    }

    if ( typeof value !== 'object' || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return typeof candidate.current === 'number'
        && Number.isFinite ( candidate.current )
        && typeof candidate.minimum === 'number'
        && Number.isFinite ( candidate.minimum )
        && candidate.current >= candidate.minimum
        && typeof candidate.target === 'number'
        && Number.isFinite ( candidate.target )
        && candidate.target > 1
        && candidate.current <= candidate.target;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isNormalizedAchievement
//
// Description:
//
//   Determines whether the supplied value satisfies the normalized achievement contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the normalized achievement contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isNormalizedAchievement ( value: unknown ): value is Achievement
{
    if ( typeof value !== 'object' || value === null || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    const hasValidGlobalPercentage = candidate.globalPercentage === null
        || ( typeof candidate.globalPercentage === 'number'
            && Number.isFinite ( candidate.globalPercentage )
            && candidate.globalPercentage >= 0
            && candidate.globalPercentage <= 100 );
    const hasValidUnlockTime = candidate.unlockTime === null
        || ( Number.isSafeInteger ( candidate.unlockTime ) && ( candidate.unlockTime as number ) > 0 );

    return typeof candidate.achieved === 'boolean'
        && typeof candidate.apiName === 'string'
        && candidate.apiName.length > 0
        && isNullableString ( candidate.description )
        && hasValidGlobalPercentage
        && isNullableString ( candidate.iconGrayUrl )
        && isNullableString ( candidate.iconUrl )
        && typeof candidate.name === 'string'
        && candidate.name.length > 0
        && isNormalizedItemProgress ( candidate.progress )
        && hasValidUnlockTime
        && ( candidate.achieved === true || candidate.unlockTime === null );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isSelectedGameAchievements
//
// Description:
//
//   Determines whether the supplied value satisfies the selected game achievements contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the selected game achievements contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isSelectedGameAchievements ( value: unknown ): value is SelectedGameAchievements
{
    if ( typeof value !== 'object' || value === null || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    if (
        !Array.isArray ( candidate.achievements )
        || !candidate.achievements.every ( isNormalizedAchievement )
        || typeof candidate.game !== 'object'
        || candidate.game === null
        || Array.isArray ( candidate.game )
        || typeof candidate.progress !== 'object'
        || candidate.progress === null
        || Array.isArray ( candidate.progress )
    )
    {
        return false;
    }

    const game     = candidate.game as Record<string, unknown>;
    const progress = candidate.progress as Record<string, unknown>;

    const achievements       = candidate.achievements;
    const total              = progress.total;
    const unlocked           = progress.unlocked;
    const percentage         = progress.percentage;
    const expectedUnlocked   = achievements.filter ( achievement => achievement.achieved ).length;
    const expectedPercentage = achievements.length === 0 ? 0 : expectedUnlocked / achievements.length * 100;

    return Number.isSafeInteger ( game.appId )
        && ( game.appId as number ) > 0
        && Array.isArray ( game.bannerUrls )
        && game.bannerUrls.every ( bannerUrl => typeof bannerUrl === 'string' && bannerUrl.length > 0 )
        && isNullableString ( game.iconUrl )
        && Array.isArray ( game.libraryLogoUrls )
        && game.libraryLogoUrls.every ( logoUrl => typeof logoUrl === 'string' && logoUrl.length > 0 )
        && typeof game.name === 'string'
        && game.name.length > 0
        && typeof percentage === 'number'
        && Number.isFinite ( percentage )
        && percentage >= 0
        && percentage <= 100
        && Number.isSafeInteger ( total )
        && total === achievements.length
        && Number.isSafeInteger ( unlocked )
        && unlocked === expectedUnlocked
        && Math.abs ( percentage - expectedPercentage ) < Number.EPSILON;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: readCachedAchievements
//
// Description:
//
//   Retrieves cached achievements through the appropriate application boundary.
//
// Parameters:
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// - cacheRequest (Request):
//   The synthetic request used as the edge-cache key.
//
// Returns:
//
//   The resulting Promise<SelectedGameAchievements | null> value.
//
//---------------------------------------------------------------------------------------------------------------------

async function readCachedAchievements
(
    edgeCache: Cache | undefined,
    cacheRequest: Request,
): Promise<SelectedGameAchievements | null>
{
    if ( edgeCache === undefined )
    {
        return null;
    }

    try
    {
        const cachedResponse = await edgeCache.match ( cacheRequest );

        if ( cachedResponse === undefined )
        {
            return null;
        }

        const cachedValue = await cachedResponse.json () as unknown;

        return isSelectedGameAchievements ( cachedValue ) ? cachedValue : null;
    }
    catch
    {
        return null;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: writeCachedAchievements
//
// Description:
//
//   Writes cached achievements without exposing implementation details to callers.
//
// Parameters:
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// - cacheRequest (Request):
//   The synthetic request used as the edge-cache key.
//
// - selectedGameAchievements (SelectedGameAchievements):
//   The complete normalized selected-game response.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

async function writeCachedAchievements
(
    edgeCache: Cache | undefined,
    cacheRequest: Request,
    selectedGameAchievements: SelectedGameAchievements,
): Promise<void>
{
    if ( edgeCache === undefined )
    {
        return;
    }

    const response = new Response (
        JSON.stringify ( selectedGameAchievements ),
        {
            headers:
            {
                'cache-control': `public, max-age=${EDGE_CACHE_TTL_SECONDS.selectedGameAchievements}`,
                'content-type':  JSON_CONTENT_TYPE,
            },
        },
    );

    try
    {
        await edgeCache.put ( cacheRequest, response );
    }
    catch
    {
        // User-specific edge caching is an optimization. Live normalized data remains a successful response.
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Merge and progress calculation.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: mergeAchievements
//
// Description:
//
//   Combines the supplied data sources into achievements.
//
// Parameters:
//
// - definitions (readonly AchievementDefinition []):
//   The normalized achievement definitions supplied by the shared schema.
//
// - playerStates (readonly PlayerAchievementState []):
//   The live unlock states associated with the achievement definitions.
//
// - rarity (GlobalAchievementRarity):
//   The global Steam unlock percentages associated with the achievements.
//
// - itemProgressDefinitions (readonly AchievementItemProgressDefinition []):
//   The shared item-progress definitions associated with the achievements.
//
// - playerItemProgressStates (readonly PlayerAchievementItemProgress [] | null):
//   The live player values associated with item-progress definitions.
//
// Returns:
//
//   The resulting Achievement [] value.
//
//---------------------------------------------------------------------------------------------------------------------

export function mergeAchievements
(
    definitions: readonly AchievementDefinition [],
    playerStates: readonly PlayerAchievementState [],
    rarity: GlobalAchievementRarity,
    itemProgressDefinitions: readonly AchievementItemProgressDefinition [] = [],
    playerItemProgressStates: readonly PlayerAchievementItemProgress [] | null = null,
): Achievement []
{
    // Index each independent Steam data source once so the final merge remains linear in the achievement count.

    const playerStatesByApiName = new Map ( playerStates.map ( state => [ state.apiName, state ] ) );
    const rarityByApiName       = new Map (
        rarity.achievements.map ( achievement => [ achievement.apiName, achievement.globalPercentage ] ),
    );
    const itemProgressDefinitionsByApiName = new Map (
        itemProgressDefinitions.map ( definition => [ definition.apiName, definition ] ),
    );
    const playerItemProgressByInternalKey = new Map (
        ( playerItemProgressStates ?? [] ).map ( state => [ state.internalKey, state.current ] ),
    );

    // Preserve schema order while projecting every definition into the normalized browser-facing contract.

    return definitions.map ( definition =>
    {
        const playerState = playerStatesByApiName.get ( definition.apiName );
        const achieved    = playerState?.achieved ?? false;
        const itemProgressDefinition = itemProgressDefinitionsByApiName.get ( definition.apiName );
        let itemProgress: AchievementItemProgress | null = null;

        // Item progress is reliable only when both a schema definition and live player state are available.

        if ( itemProgressDefinition !== undefined && playerItemProgressStates !== null )
        {
            // Completed achievements are clamped to the target; incomplete values fall back to the schema minimum.

            const current = achieved
                ? itemProgressDefinition.target
                : playerItemProgressByInternalKey.get ( itemProgressDefinition.internalKey )
                    ?? itemProgressDefinition.minimum;

            itemProgress =
            {
                current: Math.min ( itemProgressDefinition.target, Math.max ( itemProgressDefinition.minimum, current ) ),
                minimum: itemProgressDefinition.minimum,
                target:  itemProgressDefinition.target,
            };
        }

        // Return one normalized row without exposing the separate upstream response shapes.

        return (
            {
                achieved,
                apiName:          definition.apiName,
                description:      definition.description,
                globalPercentage: rarityByApiName.get ( definition.apiName ) ?? null,
                iconGrayUrl:      definition.iconGrayUrl,
                iconUrl:          definition.iconUrl,
                name:             definition.name,
                progress:         itemProgress,
                unlockTime:       achieved ? playerState?.unlockTime ?? null : null,
            }
        );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: calculateAchievementProgress
//
// Description:
//
//   Calculates achievement progress from normalized input data.
//
// Parameters:
//
// - achievements (readonly Achievement []):
//   The normalized achievements to process.
//
// Returns:
//
//   The resulting AchievementProgress value.
//
//---------------------------------------------------------------------------------------------------------------------

export function calculateAchievementProgress ( achievements: readonly Achievement [] ): AchievementProgress
{
    const total    = achievements.length;
    const unlocked = achievements.filter ( achievement => achievement.achieved ).length;

    // A zero-total game reports zero percent rather than an undefined division result.

    return (
        {
            percentage: total === 0 ? 0 : unlocked / total * 100,
            total,
            unlocked,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Selected-game aggregation.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: requireValidAppId
//
// Description:
//
//   Validates APPID and returns the accepted value or throws a safe boundary error.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function requireValidAppId ( appId: number ): void
{
    try
    {
        validateAppId ( appId );
    }
    catch
    {
        throw new InvalidAppIdError ();
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: retrieveSelectedGameAchievements
//
// Description:
//
//   Retrieves selected game achievements through the appropriate application boundary.
//
// Parameters:
//
// - steamId (string):
//   The normalized 17-digit SteamID64 identifying the user.
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - requestUrl (string):
//   The original request URL used to construct the cache key.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// - edgeCache (Cache | undefined):
//   The optional Workers Cache API instance used for short-lived user data.
//
// Returns:
//
//   The resulting Promise<SelectedGameAchievements> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function retrieveSelectedGameAchievements
(
    steamId: string,
    appId: number,
    requestUrl: string,
    apiKey: string | undefined,
    sharedCache: SharedCache,
    fetchFunction: typeof fetch = fetch,
    edgeCache: Cache | undefined = getDefaultEdgeCache (),
): Promise<SelectedGameAchievements>
{
    validateSteamId ( steamId );
    requireValidAppId ( appId );

    const cacheRequest                = createCacheRequest ( requestUrl, steamId, appId );
    const cachedSelectedAchievements = await readCachedAchievements ( edgeCache, cacheRequest );

    if ( cachedSelectedAchievements !== null )
    {
        return cachedSelectedAchievements;
    }

    const visibleGames = await retrieveVisibleLibraryGames (
        steamId,
        requestUrl,
        apiKey,
        fetchFunction,
        edgeCache,
    );
    const selectedGame = visibleGames.find ( game => game.appId === appId );

    if ( selectedGame === undefined )
    {
        throw new SteamGameNotVisibleError ();
    }

    const schema = await loadAchievementSchema ( appId, sharedCache, apiKey, fetchFunction );

    if ( schema.achievements.length === 0 )
    {
        throw new SteamGameHasNoAchievementsError ();
    }

    const [ playerStates, rarity, game, itemProgressSchema, playerItemProgressStates ] = await Promise.all (
        [
            getPlayerAchievements ( steamId, appId, apiKey, fetchFunction ),
            loadGlobalAchievementRarity ( appId, sharedCache, apiKey, fetchFunction )
                .catch ( (): GlobalAchievementRarity => ( { achievements: [] } ) ),
            loadGameMetadata (
                appId,
                selectedGame.name,
                selectedGame.iconUrl,
                sharedCache,
                fetchFunction,
            ),
            loadAchievementItemProgressSchema ( appId, sharedCache, apiKey, fetchFunction )
                .catch ( () => ( { achievements: [] } ) ),
            getPlayerAchievementItemProgress ( steamId, appId, apiKey, fetchFunction )
                .catch ( () => null ),
        ],
    );
    const achievements = mergeAchievements (
        schema.achievements,
        playerStates,
        rarity,
        itemProgressSchema.achievements,
        playerItemProgressStates,
    );
    const selectedGameAchievements: SelectedGameAchievements =
    {
        achievements,
        game,
        progress: calculateAchievementProgress ( achievements ),
    };

    await writeCachedAchievements ( edgeCache, cacheRequest, selectedGameAchievements );

    return selectedGameAchievements;
}
