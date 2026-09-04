//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/privacy-contract.test.js
//
// Description:
//   End-to-end privacy contracts from representative Steam responses through the Worker API, browser API client,
//   user-facing guidance, and two-card application state. Live Steam propagation remains outside this deterministic
//   fixture boundary.
//---------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveUser, retrieveVisibleGames } from '../public/js/api-client.js';
import { getApplicationErrorMessage } from '../public/js/error-view.js';
import {
    beginLibraryLoad,
    beginUserResolution,
    completeLibraryLoad,
    completeUserResolution,
    failLibraryLoad,
    failUserResolution,
} from '../public/js/state.js';
import { handleRequest } from '../src/index.ts';

//---------------------------------------------------------------------------------------------------------------------
// Test data and helpers.
//---------------------------------------------------------------------------------------------------------------------

const GAME_DETAILS_PRIVATE_MESSAGE =
    "This user's Steam Game Details are not publicly visible. Try another user or, if this is your profile, open "
        + 'Profile > Edit Profile > Privacy Settings, set Game Details to Public, then try again.';
const PROFILE_PRIVATE_MESSAGE =
    'This Steam profile is not public. In Steam, open Profile > Edit Profile > Privacy Settings, set My Profile '
        + 'and Game Details to Public, then try again.';
const TEST_STEAM_ID = '76561198000000000';

//---------------------------------------------------------------------------------------------------------------------
// Function: createEnvironment
//
// Description:
//
//   Creates environment from the supplied inputs.
//
// Returns:
//
//   The result produced by the create environment operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createEnvironment ()
{
    return (
        {
            ASSETS:
            {
                fetch: vi.fn ( async () => new Response ( 'static asset' ) ),
            },
            GAME_CACHE:
            {
                get: vi.fn ( async () => null ),
                put: vi.fn ( async () => undefined ),
            },
            STEAM_API_KEY: 'test-api-key',
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createFrontendState
//
// Description:
//
//   Creates frontend state from the supplied inputs.
//
// Returns:
//
//   The result produced by the create frontend state operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createFrontendState ()
{
    return (
        {
            activeCard:             'user-id',
            achievements: [],
            discoveryCursor:        null,
            error:                  null,
            gameDiscoveryStatus:    'idle',
            gameRequestNumber:      0,
            games: [],
            loadingState:           'idle',
            progress:               null,
            resolvedUser:           null,
            selectedAppId:          null,
            selectedGame:           null,
            selectedSort:           'rarity',
            showLockedAchievements: false,
            userInput:              '',
            userRequestNumber:      0,
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
    const storedResponses = new Map ();
    const match           = vi.fn ( async request => storedResponses.get ( request.url )?.clone () );
    const put             = vi.fn ( async ( request, response ) =>
    {
        storedResponses.set ( request.url, response.clone () );
    } );

    return (
        {
            cache: { match, put },
            clear: () => storedResponses.clear (),
            put,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createPublicPlayerSummaryResponse
//
// Description:
//
//   Creates public player summary response from the supplied inputs.
//
// Returns:
//
//   The result produced by the create public player summary response operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createPublicPlayerSummaryResponse ()
{
    return (
        {
            response:
            {
                players:
                [
                    {
                        avatarfull:              'https://cdn.example/avatar.jpg',
                        communityvisibilitystate: 3,
                        personaname:              'Example User',
                        profileurl:               `https://steamcommunity.com/profiles/${TEST_STEAM_ID}/`,
                        steamid:                  TEST_STEAM_ID,
                    },
                ],
            },
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createPrivatePlayerSummaryResponse
//
// Description:
//
//   Creates private player summary response from the supplied inputs.
//
// Returns:
//
//   The result produced by the create private player summary response operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createPrivatePlayerSummaryResponse ()
{
    return (
        {
            response:
            {
                players:
                [
                    {
                        communityvisibilitystate: 1,
                        steamid: TEST_STEAM_ID,
                    },
                ],
            },
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createPublicLibraryResponse
//
// Description:
//
//   Creates public library response from the supplied inputs.
//
// Returns:
//
//   The result produced by the create public library response operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createPublicLibraryResponse ()
{
    return (
        {
            response:
            {
                game_count: 1,
                games:
                [
                    {
                        appid:            620,
                        name:             'Portal 2',
                        playtime_forever: 800,
                    },
                ],
            },
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createWorkerFetch
//
// Description:
//
//   Creates worker fetch from the supplied inputs.
//
// Parameters:
//
// - environment (unknown):
//   The Cloudflare Worker bindings used by the request.
//
// Returns:
//
//   The result produced by the create worker fetch operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createWorkerFetch ( environment )
{
    return vi.fn ( async input =>
    {
        const requestUrl = new URL ( String ( input ), 'https://example.test' );

        return handleRequest ( new Request ( requestUrl ), environment );
    } );
}

afterEach ( () => vi.unstubAllGlobals () );

//---------------------------------------------------------------------------------------------------------------------
// Privacy contracts.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Automated privacy contracts', () =>
{
    it ( 'keeps a non-public profile on the User ID card with exact corrective guidance', async () =>
    {
        const environment   = createEnvironment ();
        const frontendFetch = createWorkerFetch ( environment );
        const state         = createFrontendState ();
        const steamFetch    = vi.fn ( async () => Response.json ( createPrivatePlayerSummaryResponse () ) );
        const requestNumber = beginUserResolution ( state, TEST_STEAM_ID );

        vi.stubGlobal ( 'fetch', steamFetch );

        const error = await resolveUser ( TEST_STEAM_ID, frontendFetch ).catch ( reason => reason );

        expect ( error ).toMatchObject (
            {
                code:   'STEAM_PROFILE_PRIVATE',
                status: 403,
            },
        );
        expect ( getApplicationErrorMessage ( error ) ).toBe ( PROFILE_PRIVATE_MESSAGE );
        expect ( failUserResolution ( state, requestNumber, error ) ).toBe ( true );
        expect ( state ).toMatchObject (
            {
                activeCard:  'user-id',
                games: [],
                resolvedUser: null,
                userInput:   TEST_STEAM_ID,
            },
        );
        expect ( steamFetch ).toHaveBeenCalledOnce ();
    } );

    it ( 'keeps public-profile users with private Game Details on the User ID card with exact corrective guidance',
        async () =>
        {
            const environment   = createEnvironment ();
            const frontendFetch = createWorkerFetch ( environment );
            const state         = createFrontendState ();
            const steamFetch    = vi.fn ( async input =>
            {
                const url = input instanceof URL ? input : new URL ( String ( input ) );

                return url.pathname.includes ( 'GetPlayerSummaries' )
                    ? Response.json ( createPublicPlayerSummaryResponse () )
                    : Response.json ( { response: {} } );
            } );
            const requestNumber = beginUserResolution ( state, TEST_STEAM_ID );

            vi.stubGlobal ( 'fetch', steamFetch );

            const user = await resolveUser ( TEST_STEAM_ID, frontendFetch );

            expect ( completeUserResolution ( state, requestNumber, user ) ).toBe ( true );
            expect ( beginLibraryLoad ( state, requestNumber ) ).toBe ( true );

            const error = await retrieveVisibleGames ( TEST_STEAM_ID, frontendFetch ).catch ( reason => reason );

            expect ( error ).toMatchObject (
                {
                    code:   'STEAM_GAME_DETAILS_PRIVATE',
                    status: 403,
                },
            );
            expect ( getApplicationErrorMessage ( error ) ).toBe ( GAME_DETAILS_PRIVATE_MESSAGE );
            expect ( failLibraryLoad ( state, requestNumber, error ) ).toBe ( true );
            expect ( state ).toMatchObject (
                {
                    activeCard: 'user-id',
                    games: [],
                    userInput:  TEST_STEAM_ID,
                },
            );
        } );

    it ( 'allows a public profile with public Game Details to enter the achievement card', async () =>
    {
        const environment   = createEnvironment ();
        const frontendFetch = createWorkerFetch ( environment );
        const state         = createFrontendState ();
        const steamFetch    = vi.fn ( async input =>
        {
            const url = input instanceof URL ? input : new URL ( String ( input ) );

            return url.pathname.includes ( 'GetPlayerSummaries' )
                ? Response.json ( createPublicPlayerSummaryResponse () )
                : Response.json ( createPublicLibraryResponse () );
        } );
        const requestNumber = beginUserResolution ( state, TEST_STEAM_ID );

        vi.stubGlobal ( 'fetch', steamFetch );

        const user    = await resolveUser ( TEST_STEAM_ID, frontendFetch );
        const library = await retrieveVisibleGames ( TEST_STEAM_ID, frontendFetch );

        expect ( completeUserResolution ( state, requestNumber, user ) ).toBe ( true );
        expect ( beginLibraryLoad ( state, requestNumber ) ).toBe ( true );
        expect ( completeLibraryLoad ( state, requestNumber, library ) ).toBe ( true );
        expect ( state ).toMatchObject (
            {
                activeCard:  'achievements',
                error:       null,
                resolvedUser:
                {
                    personaName: 'Example User',
                    steamId:     TEST_STEAM_ID,
                },
            },
        );
    } );

    it ( 'documents the bounded stale-profile window and detects privacy after the edge entry expires', async () =>
    {
        const environment                  = createEnvironment ();
        const frontendFetch                = createWorkerFetch ( environment );
        const { cache, clear, put }        = createMemoryCache ();
        let shouldReturnPrivateProfile     = false;
        const steamFetch                   = vi.fn ( async () => Response.json (
            shouldReturnPrivateProfile
                ? createPrivatePlayerSummaryResponse ()
                : createPublicPlayerSummaryResponse (),
        ) );

        vi.stubGlobal ( 'caches', { default: cache } );
        vi.stubGlobal ( 'fetch', steamFetch );

        await expect ( resolveUser ( TEST_STEAM_ID, frontendFetch ) ).resolves.toMatchObject (
            {
                steamId: TEST_STEAM_ID,
            },
        );
        expect ( put.mock.calls [ 0 ]?.[ 1 ].headers.get ( 'cache-control' ) ).toBe ( 'public, max-age=600' );

        shouldReturnPrivateProfile = true;

        await expect ( resolveUser ( TEST_STEAM_ID, frontendFetch ) ).resolves.toMatchObject (
            {
                steamId: TEST_STEAM_ID,
            },
        );
        expect ( steamFetch ).toHaveBeenCalledOnce ();

        clear ();

        const error = await resolveUser ( TEST_STEAM_ID, frontendFetch ).catch ( reason => reason );

        expect ( error ).toMatchObject (
            {
                code:   'STEAM_PROFILE_PRIVATE',
                status: 403,
            },
        );
        expect ( getApplicationErrorMessage ( error ) ).toBe ( PROFILE_PRIVATE_MESSAGE );
        expect ( steamFetch ).toHaveBeenCalledTimes ( 2 );
    } );
} );
