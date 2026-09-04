//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Bounded progressive classification of visible owned games. Deterministic cursor offsets and a maximum of twenty
//   schema loaders per request prevent large Steam libraries from becoming one unbounded Worker fan-out.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { loadAchievementCapability, readAchievementCapability } from '../cache/game-achievements';
import { SharedCache } from '../cache/cache';
import type { GameDiscoverySummary, GameSummary } from '../model/api';
import { decodeDiscoveryCursor, encodeDiscoveryCursor, GameDiscoveryCursorError } from './discovery-cursor';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

export const DEFAULT_DISCOVERY_BATCH_SIZE = 20;

//---------------------------------------------------------------------------------------------------------------------
// Library enrichment and ordering.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: applyCapability
//
// Description:
//
//   Applies capability to the current application state or view.
//
// Parameters:
//
// - game (GameSummary):
//   The normalized game associated with the operation.
//
// - achievementCount (number):
//   The achievement count used by the operation.
//
// Returns:
//
//   The resulting GameSummary value.
//
//---------------------------------------------------------------------------------------------------------------------

function applyCapability ( game: GameSummary, achievementCount: number ): GameSummary
{
    return (
        {
            ...game,
            achievementCapability: achievementCount > 0 ? 'yes' : 'no',
            achievementCount,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: enrichGamesWithCachedCapabilities
//
// Description:
//
//   Enriches games with cached capabilities with reusable shared-cache information.
//
// Parameters:
//
// - games (readonly GameSummary []):
//   The normalized games processed by the operation.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// Returns:
//
//   The resulting Promise<GameSummary []> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function enrichGamesWithCachedCapabilities
(
    games: readonly GameSummary [],
    sharedCache: SharedCache,
): Promise<GameSummary []>
{
    return Promise.all ( games.map ( async game =>
    {
        const capability = await readAchievementCapability ( game.appId, sharedCache );

        return capability === null ? game : applyCapability ( game, capability.achievementCount );
    } ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: compareDiscoveryPriority
//
// Description:
//
//   Compares two values using the deterministic discovery priority ordering.
//
// Parameters:
//
// - leftGame (GameSummary):
//   The left game used by the operation.
//
// - rightGame (GameSummary):
//   The right game used by the operation.
//
// Returns:
//
//   The resulting number value.
//
//---------------------------------------------------------------------------------------------------------------------

function compareDiscoveryPriority ( leftGame: GameSummary, rightGame: GameSummary ): number
{
    const leftWasPlayed  = leftGame.playtimeMinutes > 0;
    const rightWasPlayed = rightGame.playtimeMinutes > 0;

    if ( leftWasPlayed !== rightWasPlayed )
    {
        return leftWasPlayed ? -1 : 1;
    }

    const playtimeComparison = rightGame.playtimeMinutes - leftGame.playtimeMinutes;

    return playtimeComparison !== 0 ? playtimeComparison : leftGame.appId - rightGame.appId;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createInitialDiscoveryCursor
//
// Description:
//
//   Creates initial discovery cursor from the supplied inputs.
//
// Parameters:
//
// - games (readonly GameSummary []):
//   The normalized games processed by the operation.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

export function createInitialDiscoveryCursor ( games: readonly GameSummary [] ): string | null
{
    return games.some ( game => game.achievementCapability === 'unknown' ) ? encodeDiscoveryCursor ( 0 ) : null;
}

//---------------------------------------------------------------------------------------------------------------------
// Bounded discovery.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: requireValidBatchSize
//
// Description:
//
//   Validates batch size and returns the accepted value or throws a safe boundary error.
//
// Parameters:
//
// - batchSize (number):
//   The maximum number of uncached games to inspect in this discovery batch.
//
// Returns:
//
//   The resulting number value.
//
//---------------------------------------------------------------------------------------------------------------------

function requireValidBatchSize ( batchSize: number ): number
{
    if ( !Number.isSafeInteger ( batchSize ) || batchSize < 1 || batchSize > DEFAULT_DISCOVERY_BATCH_SIZE )
    {
        throw new RangeError ( `Discovery batches must contain between 1 and ${DEFAULT_DISCOVERY_BATCH_SIZE} games.` );
    }

    return batchSize;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: discoverGameAchievements
//
// Description:
//
//   Discovers game achievements in a bounded batch and returns continuation state.
//
// Parameters:
//
// - games (readonly GameSummary []):
//   The normalized games processed by the operation.
//
// - cursor (string):
//   The opaque continuation cursor supplied by the previous discovery response.
//
// - sharedCache (SharedCache):
//   The shared cache used by the operation.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// - batchSize (unknown):
//   The maximum number of uncached games to inspect in this discovery batch.
//
// Returns:
//
//   The resulting Promise<GameDiscoverySummary> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function discoverGameAchievements
(
    games: readonly GameSummary [],
    cursor: string,
    sharedCache: SharedCache,
    apiKey: string | undefined,
    fetchFunction: typeof fetch = fetch,
    batchSize = DEFAULT_DISCOVERY_BATCH_SIZE,
): Promise<GameDiscoverySummary>
{
    // Stable priority and an opaque offset make each bounded batch deterministic across continuation requests.

    const orderedGames       = [ ...games ].sort ( compareDiscoveryPriority );
    const startOffset        = decodeDiscoveryCursor ( cursor );
    const validatedBatchSize = requireValidBatchSize ( batchSize );

    if ( startOffset > orderedGames.length )
    {
        throw new GameDiscoveryCursorError ();
    }

    const eligibleGames: GameSummary [] = [];
    const unknownGames: GameSummary []  = [];
    let nextOffset                     = startOffset;

    // Scan cached classifications freely, but stop after collecting the configured number of unknown AppIDs.

    while ( nextOffset < orderedGames.length && unknownGames.length < validatedBatchSize )
    {
        const game = orderedGames [ nextOffset ];

        nextOffset += 1;

        if ( game === undefined )
        {
            continue;
        }

        if ( game.achievementCapability === 'yes' )
        {
            eligibleGames.push ( game );
        }
        else if ( game.achievementCapability === 'unknown' )
        {
            unknownGames.push ( game );
        }
    }

    // The unknown set is already bounded, so parallel probes remain below the Worker subrequest safety margin.

    const classifiedGames = await Promise.all ( unknownGames.map ( async game =>
    {
        const capability = await loadAchievementCapability (
            game.appId,
            sharedCache,
            apiKey,
            fetchFunction,
        );

        return applyCapability ( game, capability.achievementCount );
    } ) );

    eligibleGames.push ( ...classifiedGames.filter ( game => game.achievementCapability === 'yes' ) );

    // Advance past every inspected game, including cached negatives, so continuation cannot repeat work.

    return (
        {
            discoveryCursor: nextOffset < orderedGames.length ? encodeDiscoveryCursor ( nextOffset ) : null,
            games:           eligibleGames,
        }
    );
}
