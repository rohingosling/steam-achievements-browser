//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-29
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for the Worker routing boundary and normalized application API responses.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRequest } from '../src/index';
import { encodeDiscoveryCursor } from '../src/api/discovery-cursor';

//---------------------------------------------------------------------------------------------------------------------
// Test helpers.
//---------------------------------------------------------------------------------------------------------------------

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
    const assetFetch  = vi.fn ( async () => new Response ( 'static asset' ) );
    const environment =
    {
        ASSETS:
        {
            fetch: assetFetch,
        },
        GAME_CACHE:
        {
            get: vi.fn ( async () => null ),
            put: vi.fn ( async () => undefined ),
        },
        STEAM_API_KEY: 'test-api-key',
    };

    return (
        { assetFetch, environment }
    );
}

afterEach ( () => vi.unstubAllGlobals () );

//---------------------------------------------------------------------------------------------------------------------
// Worker routes.
//---------------------------------------------------------------------------------------------------------------------

describe ( 'Worker routing', () =>
{
    it ( 'returns JSON from the health endpoint', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const request                     = new Request ( 'https://example.test/api/health' );
        const response                    = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 200 );
        expect ( response.headers.get ( 'content-type' ) ).toBe ( 'application/json; charset=utf-8' );
        expect ( response.headers.get ( 'cache-control' ) ).toBe ( 'no-store' );
        await expect ( response.json () ).resolves.toEqual (
            {
                service: 'steam-achievement-browser',
                status:  'ok',
            },
        );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'rejects unsupported methods at the health endpoint', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const request                     = new Request ( 'https://example.test/api/health', { method: 'POST' } );
        const response                    = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 405 );
        expect ( response.headers.get ( 'allow' ) ).toBe ( 'GET' );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'serves only validated Steam raster images from the screenshot endpoint', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const imageBytes                  = new Uint8Array ( [ 137, 80, 78, 71 ] );
        const steamFetch                  = vi.fn ( async () => new Response (
            imageBytes,
            { headers: { 'content-type': 'image/png' } },
        ) );

        vi.stubGlobal ( 'fetch', steamFetch );

        const validUrl = encodeURIComponent (
            'https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg',
        );
        const validResponse = await handleRequest (
            new Request ( `https://example.test/api/images?url=${validUrl}` ),
            environment,
        );
        const invalidResponse = await handleRequest (
            new Request ( 'https://example.test/api/images?url=https%3A%2F%2Fexample.test%2Fprivate' ),
            environment,
        );

        expect ( validResponse.status ).toBe ( 200 );
        expect ( validResponse.headers.get ( 'content-type' ) ).toBe ( 'image/png' );
        expect ( new Uint8Array ( await validResponse.arrayBuffer () ) ).toEqual ( imageBytes );
        expect ( invalidResponse.status ).toBe ( 400 );
        expect ( steamFetch ).toHaveBeenCalledOnce ();
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'rejects unsupported screenshot-image methods without contacting Steam', async () =>
    {
        const { environment } = createEnvironment ();
        const steamFetch      = vi.fn ();

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request ( 'https://example.test/api/images', { method: 'POST' } );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 405 );
        expect ( response.headers.get ( 'allow' ) ).toBe ( 'GET' );
        expect ( steamFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'does not serve unknown API paths through static assets', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const request                     = new Request ( 'https://example.test/api/unknown' );
        const response                    = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 404 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code:    'API_ROUTE_NOT_FOUND',
                    message: 'The requested API route does not exist.',
                },
            },
        );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'normalizes successful Steam connectivity probes', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const steamFetch                  = vi.fn ( async ( _input: RequestInfo | URL, _init?: RequestInit ) => Response.json (
            {
                apilist:
                {
                    interfaces: [],
                },
            },
        ) );

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request ( 'https://example.test/api/steam/status' );
        const response = await handleRequest ( request, environment );
        const fetchUrl = steamFetch.mock.calls [ 0 ]?.[ 0 ];

        expect ( response.status ).toBe ( 200 );
        await expect ( response.json () ).resolves.toEqual (
            {
                service: 'steam-web-api',
                status:  'ok',
            },
        );
        expect ( fetchUrl ).toBeInstanceOf ( URL );

        if ( ! ( fetchUrl instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam client to call fetch with a URL.' );
        }

        expect ( fetchUrl.searchParams.get ( 'key' ) ).toBe ( 'test-api-key' );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'does not expose malformed Steam response bodies', async () =>
    {
        const { environment } = createEnvironment ();

        vi.stubGlobal ( 'fetch', vi.fn ( async () => new Response ( 'private upstream diagnostics' ) ) );

        const request  = new Request ( 'https://example.test/api/steam/status' );
        const response = await handleRequest ( request, environment );
        const body     = await response.text ();

        expect ( response.status ).toBe ( 502 );
        expect ( body ).toContain ( 'STEAM_INVALID_RESPONSE' );
        expect ( body ).not.toContain ( 'private upstream diagnostics' );
        expect ( body ).not.toContain ( 'test-api-key' );
    } );

    it ( 'maps a missing Steam secret to a configuration error without calling Steam', async () =>
    {
        const { environment }       = createEnvironment ();
        const environmentWithoutKey = { ...environment, STEAM_API_KEY: undefined };
        const steamFetch            = vi.fn ();

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request ( 'https://example.test/api/steam/status' );
        const response = await handleRequest ( request, environmentWithoutKey );

        expect ( response.status ).toBe ( 500 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code:    'STEAM_CONFIGURATION_ERROR',
                    message: 'Steam API access is not configured.',
                },
            },
        );
        expect ( steamFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'returns a normalized user from the user-resolution endpoint', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const steamFetch                  = vi.fn ( async () => Response.json (
            {
                response:
                {
                    players:
                    [
                        {
                            avatarfull:  'https://cdn.example/avatar.jpg',
                            personaname: 'Example User',
                            profileurl:  'https://steamcommunity.com/profiles/76561198000000000/',
                            steamid:     '76561198000000000',
                        },
                    ],
                },
            },
        ) );

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request ( 'https://example.test/api/users/76561198000000000' );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 200 );
        expect ( response.headers.get ( 'cache-control' ) ).toBe ( 'no-store' );
        await expect ( response.json () ).resolves.toEqual (
            {
                avatarUrl:  'https://cdn.example/avatar.jpg',
                personaName: 'Example User',
                profileUrl:  'https://steamcommunity.com/profiles/76561198000000000/',
                steamId:     '76561198000000000',
            },
        );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'maps invalid user identifiers without calling Steam', async () =>
    {
        const { environment } = createEnvironment ();
        const steamFetch      = vi.fn ();

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request ( 'https://example.test/api/users/12345' );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 400 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code:    'STEAM_USER_IDENTIFIER_INVALID',
                    message:
                        'Enter a valid SteamID64, Steam Community profile URL, or custom Steam Community URL name.',
                },
            },
        );
        expect ( steamFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'maps unresolved vanity identifiers to a stable not-found error', async () =>
    {
        const { environment } = createEnvironment ();

        vi.stubGlobal ( 'fetch', vi.fn ( async () => Response.json (
            {
                response:
                {
                    message: 'No match',
                    success: 42,
                },
            },
        ) ) );

        const request  = new Request ( 'https://example.test/api/users/missing-user' );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 404 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code:    'STEAM_USER_NOT_FOUND',
                    message: 'No Steam user was found for that identifier.',
                },
            },
        );
    } );

    it ( 'maps a non-public Steam profile to an actionable privacy error', async () =>
    {
        const { environment } = createEnvironment ();

        vi.stubGlobal ( 'fetch', vi.fn ( async () => Response.json (
            {
                response:
                {
                    players:
                    [
                        {
                            communityvisibilitystate: 1,
                            steamid: '76561198000000000',
                        },
                    ],
                },
            },
        ) ) );

        const request  = new Request ( 'https://example.test/api/users/76561198000000000' );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 403 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code: 'STEAM_PROFILE_PRIVATE',
                    message:
                        'This Steam profile is not public. In Steam, open Profile > Edit Profile > Privacy Settings, '
                            + 'set My Profile and Game Details to Public, then try again.',
                },
            },
        );
    } );

    it ( 'returns a normalized visible library from the games endpoint', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const steamFetch                  = vi.fn ( async () => Response.json (
            {
                response:
                {
                    game_count: 1,
                    games:
                    [
                        {
                            appid:            620,
                            img_icon_url:     '',
                            name:             'Portal 2',
                            playtime_forever: 800,
                        },
                    ],
                },
            },
        ) );

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request ( 'https://example.test/api/users/76561198000000000/games' );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 200 );
        await expect ( response.json () ).resolves.toEqual (
            {
                discoveryCursor: expect.any ( String ),
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
        );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'returns one bounded progressive discovery result', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const steamFetch                  = vi.fn ( async ( input: RequestInfo | URL ) =>
        {
            const url = input instanceof URL ? input : new URL ( String ( input ) );

            if ( url.pathname.includes ( 'GetOwnedGames' ) )
            {
                return Response.json (
                    {
                        response:
                        {
                            game_count: 2,
                            games:
                            [
                                { appid: 620, name: 'Portal 2', playtime_forever: 800 },
                                { appid: 400, name: 'Portal', playtime_forever: 400 },
                            ],
                        },
                    },
                );
            }

            const appId = Number ( url.searchParams.get ( 'appid' ) );

            return Response.json (
                {
                    game:
                    {
                        availableGameStats:
                        {
                            achievements: appId === 620
                                ? [ { displayName: 'Test', name: 'TEST' } ]
                                : [],
                        },
                    },
                },
            );
        } );

        vi.stubGlobal ( 'fetch', steamFetch );

        const cursor   = encodeDiscoveryCursor ( 0 );
        const request  = new Request (
            `https://example.test/api/users/76561198000000000/games/discover?cursor=${cursor}`,
        );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 200 );
        await expect ( response.json () ).resolves.toEqual (
            {
                discoveryCursor: null,
                games:
                [
                    {
                        achievementCapability: 'yes',
                        achievementCount:      1,
                        appId:                 620,
                        bannerUrl:             null,
                        iconUrl:               null,
                        name:                  'Portal 2',
                        playtimeMinutes:       800,
                    },
                ],
            },
        );
        expect ( steamFetch ).toHaveBeenCalledTimes ( 3 );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'rejects a missing discovery cursor without contacting Steam', async () =>
    {
        const { environment } = createEnvironment ();
        const steamFetch      = vi.fn ();

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request ( 'https://example.test/api/users/76561198000000000/games/discover' );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 400 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code:    'GAME_DISCOVERY_CURSOR_INVALID',
                    message: 'The game-discovery cursor is invalid.',
                },
            },
        );
        expect ( steamFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'returns one normalized selected-game achievement response', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const steamFetch                  = vi.fn ( async ( input: RequestInfo | URL ) =>
        {
            const url = input instanceof URL ? input : new URL ( String ( input ) );

            if ( url.origin === 'https://store.steampowered.com' )
            {
                return Response.json (
                    {
                        620:
                        {
                            data:
                            {
                                header_image: 'https://cdn.example/header.jpg',
                                name:         'Portal 2',
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
                            games: [ { appid: 620, name: 'Portal 2', playtime_forever: 800 } ],
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
                                achievements: [ { displayName: 'Test Achievement', name: 'TEST' } ],
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
                            achievements: [ { achieved: 1, apiname: 'TEST', unlocktime: 1_780_000_000 } ],
                            success: true,
                        },
                    },
                );
            }

            return Response.json (
                {
                    achievementpercentages:
                    {
                        achievements: [ { name: 'TEST', percent: '4.5' } ],
                    },
                },
            );
        } );

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request (
            'https://example.test/api/users/76561198000000000/games/620/achievements',
        );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 200 );
        expect ( response.headers.get ( 'cache-control' ) ).toBe ( 'no-store' );
        await expect ( response.json () ).resolves.toEqual (
            {
                achievements:
                [
                    {
                        achieved:        true,
                        apiName:         'TEST',
                        description:     null,
                        globalPercentage: 4.5,
                        iconGrayUrl:     null,
                        iconUrl:         null,
                        name:            'Test Achievement',
                        progress:        null,
                        unlockTime:      1_780_000_000,
                    },
                ],
                game:
                {
                    appId: 620,
                    bannerUrls:
                    [
                        'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_hero.jpg',
                        'https://cdn.example/header.jpg',
                    ],
                    iconUrl: null,
                    libraryLogoUrls:
                    [
                        'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo_2x.png',
                        'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo.png',
                    ],
                    name: 'Portal 2',
                },
                progress:
                {
                    percentage: 100,
                    total:      1,
                    unlocked:   1,
                },
            },
        );
        expect ( assetFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'rejects an invalid selected-game AppID without contacting Steam', async () =>
    {
        const { environment } = createEnvironment ();
        const steamFetch      = vi.fn ();

        vi.stubGlobal ( 'fetch', steamFetch );

        const request  = new Request (
            'https://example.test/api/users/76561198000000000/games/not-an-app-id/achievements',
        );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 400 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code:    'STEAM_APP_ID_INVALID',
                    message: 'The Steam AppID is invalid.',
                },
            },
        );
        expect ( steamFetch ).not.toHaveBeenCalled ();
    } );

    it ( 'maps private Game Details to a stable API error', async () =>
    {
        const { environment } = createEnvironment ();

        vi.stubGlobal ( 'fetch', vi.fn ( async () => Response.json ( { response: {} } ) ) );

        const request  = new Request ( 'https://example.test/api/users/76561198000000000/games' );
        const response = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 403 );
        await expect ( response.json () ).resolves.toEqual (
            {
                error:
                {
                    code:    'STEAM_GAME_DETAILS_PRIVATE',
                    message:
                        "This user's Steam Game Details are not publicly visible. If this is your profile, open "
                            + 'Profile > Edit Profile > Privacy Settings, set Game Details to Public, then try again.',
                },
            },
        );
    } );

    it ( 'delegates non-API requests to Workers Static Assets', async () =>
    {
        const { assetFetch, environment } = createEnvironment ();
        const request                     = new Request ( 'https://example.test/css/tokens.css' );
        const response                    = await handleRequest ( request, environment );

        expect ( response.status ).toBe ( 200 );
        expect ( await response.text () ).toBe ( 'static asset' );
        expect ( assetFetch ).toHaveBeenCalledOnce ();
        expect ( assetFetch ).toHaveBeenCalledWith ( request );
    } );
} );
