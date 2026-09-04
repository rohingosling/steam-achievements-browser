//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/frontend-user.test.js
//
// Description:
//   Unit tests for browser-side normalized user API handling and stale user-dependent state clearing.
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import {
    ApplicationApiError,
    discoverAchievementGames,
    resolveUser,
    retrieveVisibleGames,
} from '../public/js/api-client.js';
import {
    beginLibraryLoad,
    beginUserResolution,
    completeGameDiscoveryBatch,
    completeLibraryLoad,
    completeUserResolution,
    failLibraryLoad,
    failUserResolution,
    resetUserFlow,
} from '../public/js/state.js';

//---------------------------------------------------------------------------------------------------------------------
// Browser API client.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Frontend user API client', () =>
{
    it ( 'encodes the complete committed identifier and returns normalized data', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                avatarUrl:  null,
                personaName: 'Example User',
                profileUrl:  'https://steamcommunity.com/id/exampleuser/',
                steamId:     '76561198000000000',
            },
        ) );
        const identifier = 'https://steamcommunity.com/id/exampleuser/';
        const user       = await resolveUser ( identifier, fetchFunction );

        expect ( user.personaName ).toBe ( 'Example User' );
        expect ( fetchFunction ).toHaveBeenCalledWith (
            `/api/users/${encodeURIComponent ( identifier )}`,
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    } );

    it ( 'preserves a stable normalized API error', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                error:
                {
                    code:    'STEAM_USER_NOT_FOUND',
                    message: 'No Steam user was found for that identifier.',
                },
            },
            {
                status: 404,
            },
        ) );
        const error = await resolveUser ( 'missing-user', fetchFunction ).catch ( reason => reason );

        expect ( error ).toBeInstanceOf ( ApplicationApiError );
        expect ( error ).toMatchObject (
            {
                code:   'STEAM_USER_NOT_FOUND',
                status: 404,
            },
        );
    } );

    it ( 'rejects successful responses that are not normalized users', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json ( { response: { players: [] } } ) );

        await expect ( resolveUser ( 'exampleuser', fetchFunction ) ).rejects.toMatchObject (
            {
                code: 'APPLICATION_INVALID_RESPONSE',
            },
        );
    } );
} );

describe ( 'Frontend visible-library API client', () =>
{
    it ( 'requests and validates normalized visible games', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                discoveryCursor: null,
                games:
                [
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
            },
        ) );
        const library = await retrieveVisibleGames ( '76561198000000000', fetchFunction );

        expect ( library.games [ 0 ]?.name ).toBe ( 'Portal 2' );
        expect ( fetchFunction ).toHaveBeenCalledWith (
            '/api/users/76561198000000000/games',
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    } );

    it ( 'requests and validates a progressive discovery batch', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                discoveryCursor: null,
                games:
                [
                    {
                        achievementCapability: 'yes',
                        achievementCount:      51,
                        appId:                 620,
                        bannerUrl:             null,
                        iconUrl:               null,
                        name:                  'Portal 2',
                        playtimeMinutes:       800,
                    },
                ],
            },
        ) );
        const discovery = await discoverAchievementGames (
            '76561198000000000',
            'cursor-value',
            fetchFunction,
        );

        expect ( discovery.games [ 0 ]?.achievementCount ).toBe ( 51 );
        expect ( fetchFunction ).toHaveBeenCalledWith (
            '/api/users/76561198000000000/games/discover?cursor=cursor-value',
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
            },
        );
    } );

    it ( 'preserves a normalized privacy error', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                error:
                {
                    code:    'STEAM_GAME_DETAILS_PRIVATE',
                    message: "This user's Steam Game Details are not publicly visible.",
                },
            },
            {
                status: 403,
            },
        ) );

        await expect ( retrieveVisibleGames ( '76561198000000000', fetchFunction ) ).rejects.toMatchObject (
            {
                code:   'STEAM_GAME_DETAILS_PRIVATE',
                status: 403,
            },
        );
    } );
} );

//---------------------------------------------------------------------------------------------------------------------
// User-dependent state.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Frontend user state', () =>
{
    //-----------------------------------------------------------------------------------------------------------------
    // Function: createState
    //
    // Description:
    //
    //   Creates state from the supplied inputs.
    //
    // Returns:
    //
    //   The result produced by the create state operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function createState ()
    {
        return (
            {
                activeCard:          'achievements',
                achievements: [ { apiName: 'OLD_ACHIEVEMENT' } ],
                discoveryCursor:     null,
                error:               new Error ( 'old error' ),
                gameDiscoveryStatus: 'complete',
                gameRequestNumber:   0,
                games: [ { appId: 1 } ],
                loadingState:        'idle',
                resolvedUser:        { steamId: 'old' },
                selectedAppId:       1,
                selectedGame:        { appId: 1 },
                selectedSort:        'name',
                showLockedAchievements: true,
                progress:            { total: 1, unlocked: 1 },
                userInput:           'old-user',
                userRequestNumber:   0,
            }
        );
    }

    it ( 'clears every stale user-dependent value when resolution begins', () =>
    {
        const state         = createState ();
        const requestNumber = beginUserResolution ( state, 'new-user' );

        expect ( state ).toMatchObject (
            {
                achievements: [],
                error:               null,
                gameDiscoveryStatus: 'idle',
                games: [],
                loadingState:        'user',
                resolvedUser:        null,
                selectedAppId:       null,
                selectedGame:        null,
                progress:            null,
                userInput:           'new-user',
            },
        );
        expect ( requestNumber ).toBe ( 1 );
    } );

    it ( 'ignores completion from an older request', () =>
    {
        const state              = createState ();
        const olderRequestNumber = beginUserResolution ( state, 'older-user' );

        beginUserResolution ( state, 'newer-user' );

        expect ( completeUserResolution (
            state,
            olderRequestNumber,
            { steamId: '76561198000000000' },
        ) ).toBe ( false );
        expect ( failUserResolution (
            state,
            olderRequestNumber,
            new Error ( 'stale failure' ),
        ) ).toBe ( false );
        expect ( state.userInput ).toBe ( 'newer-user' );
        expect ( state.loadingState ).toBe ( 'user' );
    } );

    it ( 'holds a normalized visible library after user resolution', () =>
    {
        const state         = createState ();
        const requestNumber = beginUserResolution ( state, 'exampleuser' );
        const user          = { steamId: '76561198000000000' };
        const library       =
        {
            discoveryCursor: null,
            games:
            [
                { achievementCapability: 'yes', appId: 620, name: 'Portal 2' },
            ],
        };

        expect ( completeUserResolution ( state, requestNumber, user ) ).toBe ( true );
        expect ( beginLibraryLoad ( state, requestNumber ) ).toBe ( true );
        expect ( completeLibraryLoad ( state, requestNumber, library ) ).toBe ( true );
        expect ( state.games ).toEqual ( library.games );
        expect ( state.gameDiscoveryStatus ).toBe ( 'complete' );
        expect ( state.loadingState ).toBe ( 'idle' );
    } );

    it ( 'merges progressive eligible games without duplicates and preserves pending state', () =>
    {
        const state         = createState ();
        const requestNumber = beginUserResolution ( state, 'exampleuser' );
        const user          = { steamId: '76561198000000000' };
        const portal        = { achievementCapability: 'yes', appId: 620, name: 'Portal 2' };

        completeUserResolution ( state, requestNumber, user );
        beginLibraryLoad ( state, requestNumber );
        completeLibraryLoad (
            state,
            requestNumber,
            {
                discoveryCursor: 'first-cursor',
                games: [ portal ],
            },
        );

        expect ( completeGameDiscoveryBatch (
            state,
            requestNumber,
            {
                discoveryCursor: 'second-cursor',
                games:
                [
                    portal,
                    { achievementCapability: 'yes', appId: 400, name: 'Portal' },
                ],
            },
        ) ).toBe ( true );
        expect ( state.games.map ( game => game.appId ) ).toEqual ( [ 620, 400 ] );
        expect ( state.discoveryCursor ).toBe ( 'second-cursor' );
        expect ( state.gameDiscoveryStatus ).toBe ( 'pending' );
    } );

    it ( 'keeps the resolved user while recording a library privacy error', () =>
    {
        const state         = createState ();
        const requestNumber = beginUserResolution ( state, 'exampleuser' );
        const user          = { steamId: '76561198000000000' };
        const error         = new Error ( 'Game Details are private.' );

        completeUserResolution ( state, requestNumber, user );
        beginLibraryLoad ( state, requestNumber );

        expect ( failLibraryLoad ( state, requestNumber, error ) ).toBe ( true );
        expect ( state.resolvedUser ).toBe ( user );
        expect ( state.games ).toEqual ( [] );
        expect ( state.error ).toBe ( error );
    } );

    it ( 'resets every user-dependent value and invalidates outstanding requests when changing user', () =>
    {
        const state             = createState ();
        const userRequestNumber = state.userRequestNumber;
        const gameRequestNumber = state.gameRequestNumber;

        resetUserFlow ( state );

        expect ( state ).toMatchObject (
            {
                achievements: [],
                activeCard:             'user-id',
                discoveryCursor:        null,
                error:                  null,
                gameDiscoveryStatus:    'idle',
                games: [],
                loadingState:           'idle',
                progress:               null,
                resolvedUser:           null,
                selectedAppId:          null,
                selectedGame:           null,
                selectedSort:           'rarity',
                showLockedAchievements: false,
                userInput:              '',
            },
        );
        expect ( state.userRequestNumber ).toBe ( userRequestNumber + 1 );
        expect ( state.gameRequestNumber ).toBe ( gameRequestNumber + 1 );
    } );
} );
