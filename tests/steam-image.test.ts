//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-03
// Author:  Rohin Gosling
//
// Description:
//
//   Verifies the screenshot image endpoint's Steam-host allow-list, raster-content validation, response-size ceiling,
//   redirect validation, and safe response headers.
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import {
    createSteamImageFetchCandidates,
    isAllowedSteamImageUrl,
    retrieveSteamImage,
    SteamImageProxyError,
} from '../src/api/image';

const VALID_IMAGE_URL        = 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg';
const VALID_MEDIA_IMAGE_URL  = 'https://media.steampowered.com/steamcommunity/public/images/apps/620/icon.jpg';
const MODERN_MEDIA_IMAGE_URL = 'https://shared.fastly.steamstatic.com/community_assets/images/apps/620/icon.jpg';
const LIBRARY_HERO_IMAGE_URL = 'https://cdn.cloudflare.steamstatic.com/steam/apps/65980/library_hero.jpg';
const MODERN_HERO_IMAGE_URL  = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/65980/library_hero.jpg';

describe ( 'Steam screenshot image boundary', () =>
{
    it ( 'accepts only credential-free HTTPS URLs on approved Steam static hosts', () =>
    {
        expect ( isAllowedSteamImageUrl ( VALID_IMAGE_URL ) ).toBe ( true );
        expect ( isAllowedSteamImageUrl ( VALID_MEDIA_IMAGE_URL ) ).toBe ( true );
        expect ( isAllowedSteamImageUrl ( 'https://avatars.akamai.steamstatic.com/avatar.jpg' ) ).toBe ( true );
        expect ( isAllowedSteamImageUrl ( 'https://steamcdn-a.akamaihd.net/steam/apps/620/header.jpg' ) ).toBe ( true );
        expect ( isAllowedSteamImageUrl ( 'http://cdn.cloudflare.steamstatic.com/image.jpg' ) ).toBe ( false );
        expect ( isAllowedSteamImageUrl ( 'https://steamstatic.com.example.test/image.jpg' ) ).toBe ( false );
        expect ( isAllowedSteamImageUrl ( 'https://user@cdn.cloudflare.steamstatic.com/image.jpg' ) ).toBe ( false );
        expect ( isAllowedSteamImageUrl ( 'not a URL' ) ).toBe ( false );
    } );

    it ( 'prefers Fastly-backed Steam aliases while retaining the approved source as fallback', () =>
    {
        expect ( createSteamImageFetchCandidates ( VALID_MEDIA_IMAGE_URL ) ).toEqual (
            [
                MODERN_MEDIA_IMAGE_URL,
                VALID_MEDIA_IMAGE_URL,
            ],
        );
        expect (
            createSteamImageFetchCandidates (
                'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/620/icon.jpg?version=2',
            ),
        ).toEqual (
            [
                `${MODERN_MEDIA_IMAGE_URL}?version=2`,
                'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/620/icon.jpg?version=2',
            ],
        );
        expect (
            createSteamImageFetchCandidates (
                'https://media.steampowered.com/steamcommunity/public/images/avatars/ab/avatar.jpg',
            ),
        ).toEqual (
            [
                'https://cdn.fastly.steamstatic.com/steamcommunity/public/images/avatars/ab/avatar.jpg',
                'https://media.steampowered.com/steamcommunity/public/images/avatars/ab/avatar.jpg',
            ],
        );
        expect (
            createSteamImageFetchCandidates ( 'https://avatars.steamstatic.com/avatar.jpg' ),
        ).toEqual (
            [
                'https://avatars.fastly.steamstatic.com/avatar.jpg',
                'https://avatars.steamstatic.com/avatar.jpg',
            ],
        );
        expect (
            createSteamImageFetchCandidates ( 'https://cdn.fastly.steamstatic.com/steam/apps/620/header.jpg' ),
        ).toEqual (
            [
                'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/header.jpg',
                'https://cdn.fastly.steamstatic.com/steam/apps/620/header.jpg',
            ],
        );
        expect (
            createSteamImageFetchCandidates ( `${LIBRARY_HERO_IMAGE_URL}?version=2#capture` ),
        ).toEqual (
            [
                `${MODERN_HERO_IMAGE_URL}?version=2#capture`,
                `${LIBRARY_HERO_IMAGE_URL}?version=2#capture`,
            ],
        );
        expect (
            createSteamImageFetchCandidates (
                'https://steamcdn-a.akamaihd.net/steam/apps/65980/logo_2x.png',
            ),
        ).toEqual (
            [
                'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/65980/logo_2x.png',
                'https://steamcdn-a.akamaihd.net/steam/apps/65980/logo_2x.png',
            ],
        );
    } );

    it ( 'returns validated raster bytes with private cache and no-sniff headers', async () =>
    {
        const imageBytes    = new Uint8Array ( [ 137, 80, 78, 71 ] );
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL, _init?: RequestInit ) => new Response (
            imageBytes,
            {
                headers:
                {
                    'content-length': String ( imageBytes.byteLength ),
                    'content-type':   'image/png',
                },
            },
        ) );
        const response = await retrieveSteamImage ( VALID_IMAGE_URL, fetchFunction );

        expect ( fetchFunction ).toHaveBeenCalledWith (
            'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/header.jpg',
            expect.objectContaining ( { redirect: 'manual' } ),
        );
        expect ( fetchFunction.mock.calls [ 0 ]?.[ 1 ] ).not.toHaveProperty ( 'cf' );
        expect ( response.status ).toBe ( 200 );
        expect ( response.headers.get ( 'content-type' ) ).toBe ( 'image/png' );
        expect ( response.headers.get ( 'cache-control' ) ).toBe ( 'private, max-age=300' );
        expect ( response.headers.get ( 'x-content-type-options' ) ).toBe ( 'nosniff' );
        expect ( new Uint8Array ( await response.arrayBuffer () ) ).toEqual ( imageBytes );
    } );

    it ( 'rejects invalid URLs before making an upstream request', async () =>
    {
        const fetchFunction = vi.fn ();

        await expect ( retrieveSteamImage ( 'https://example.test/image.png', fetchFunction ) ).rejects.toMatchObject (
            {
                code:   'STEAM_IMAGE_INVALID',
                status: 400,
            },
        );
        expect ( fetchFunction ).not.toHaveBeenCalled ();
    } );

    it ( 'rejects non-raster responses and oversized declared payloads', async () =>
    {
        const htmlFetch = vi.fn ( async () => new Response (
            '<html></html>',
            { headers: { 'content-type': 'text/html' } },
        ) );
        const oversizedFetch = vi.fn ( async () => new Response (
            new Uint8Array ( [ 1 ] ),
            {
                headers:
                {
                    'content-length': String ( ( 10 * 1024 * 1024 ) + 1 ),
                    'content-type':   'image/jpeg',
                },
            },
        ) );

        await expect ( retrieveSteamImage ( VALID_IMAGE_URL, htmlFetch ) ).rejects.toBeInstanceOf (
            SteamImageProxyError,
        );
        await expect ( retrieveSteamImage ( VALID_IMAGE_URL, oversizedFetch ) ).rejects.toMatchObject (
            {
                code:   'STEAM_IMAGE_TOO_LARGE',
                status: 413,
            },
        );
    } );

    it ( 'follows approved redirects and rejects an unapproved destination before contacting it', async () =>
    {
        const approvedRedirectUrl = 'https://cdn.akamai.steamstatic.com/redirected-image.png';
        const approvedFetch       = vi.fn ()
            .mockResolvedValueOnce ( new Response (
                null,
                { headers: { location: approvedRedirectUrl }, status: 302 },
            ) )
            .mockResolvedValueOnce ( new Response (
                new Uint8Array ( [ 137, 80, 78, 71 ] ),
                { headers: { 'content-type': 'image/png' } },
            ) );
        const rejectedFetch = vi.fn ( async () => new Response (
            null,
            { headers: { location: 'https://example.test/redirected-image.png' }, status: 302 },
        ) );

        await expect (
            retrieveSteamImage ( VALID_IMAGE_URL, approvedFetch ),
        ).resolves.toMatchObject ( { status: 200 } );
        expect ( approvedFetch ).toHaveBeenCalledTimes ( 2 );
        expect ( approvedFetch ).toHaveBeenNthCalledWith (
            2,
            approvedRedirectUrl,
            expect.objectContaining ( { redirect: 'manual' } ),
        );

        await expect ( retrieveSteamImage ( VALID_IMAGE_URL, rejectedFetch ) ).rejects.toMatchObject (
            {
                code:   'STEAM_IMAGE_UNAVAILABLE',
                status: 502,
            },
        );
        expect ( rejectedFetch ).toHaveBeenCalledOnce ();
    } );

    it ( 'falls back to the original approved host when the preferred alias fails', async () =>
    {
        const imageBytes    = new Uint8Array ( [ 137, 80, 78, 71 ] );
        const fetchFunction = vi.fn ()
            .mockResolvedValueOnce ( new Response ( 'Forbidden', { status: 403 } ) )
            .mockResolvedValueOnce ( new Response (
                imageBytes,
                { headers: { 'content-type': 'image/png' } },
            ) );

        await expect ( retrieveSteamImage ( VALID_MEDIA_IMAGE_URL, fetchFunction ) ).resolves.toMatchObject (
            { status: 200 },
        );
        expect ( fetchFunction ).toHaveBeenNthCalledWith (
            1,
            MODERN_MEDIA_IMAGE_URL,
            expect.objectContaining ( { redirect: 'manual' } ),
        );
        expect ( fetchFunction ).toHaveBeenNthCalledWith (
            2,
            VALID_MEDIA_IMAGE_URL,
            expect.objectContaining ( { redirect: 'manual' } ),
        );
    } );

    it ( 'fetches Library Hero artwork through its modern store-item path before the original location', async () =>
    {
        const imageBytes    = new Uint8Array ( [ 255, 216, 255 ] );
        const fetchFunction = vi.fn ()
            .mockResolvedValueOnce ( new Response ( 'Bad gateway', { status: 502 } ) )
            .mockResolvedValueOnce ( new Response (
                imageBytes,
                { headers: { 'content-type': 'image/jpeg' } },
            ) );

        await expect ( retrieveSteamImage ( LIBRARY_HERO_IMAGE_URL, fetchFunction ) ).resolves.toMatchObject (
            { status: 200 },
        );
        expect ( fetchFunction ).toHaveBeenNthCalledWith (
            1,
            MODERN_HERO_IMAGE_URL,
            expect.objectContaining ( { redirect: 'manual' } ),
        );
        expect ( fetchFunction ).toHaveBeenNthCalledWith (
            2,
            LIBRARY_HERO_IMAGE_URL,
            expect.objectContaining ( { redirect: 'manual' } ),
        );
    } );

    it ( 'falls back when the preferred alias has a transport failure', async () =>
    {
        const fetchFunction = vi.fn ()
            .mockRejectedValueOnce ( new TypeError ( 'network unavailable' ) )
            .mockResolvedValueOnce ( new Response (
                new Uint8Array ( [ 137, 80, 78, 71 ] ),
                { headers: { 'content-type': 'image/png' } },
            ) );

        await expect ( retrieveSteamImage ( VALID_MEDIA_IMAGE_URL, fetchFunction ) ).resolves.toMatchObject (
            { status: 200 },
        );
        expect ( fetchFunction ).toHaveBeenCalledTimes ( 2 );
    } );

    it ( 'falls back when the preferred alias returns non-image content', async () =>
    {
        const fetchFunction = vi.fn ()
            .mockResolvedValueOnce ( new Response (
                '<html></html>',
                { headers: { 'content-type': 'text/html' } },
            ) )
            .mockResolvedValueOnce ( new Response (
                new Uint8Array ( [ 137, 80, 78, 71 ] ),
                { headers: { 'content-type': 'image/png' } },
            ) );

        await expect ( retrieveSteamImage ( VALID_MEDIA_IMAGE_URL, fetchFunction ) ).resolves.toMatchObject (
            { status: 200 },
        );
        expect ( fetchFunction ).toHaveBeenCalledTimes ( 2 );
    } );

    it ( 'maps network failures to a safe upstream error', async () =>
    {
        const fetchFunction = vi.fn ( async () =>
        {
            throw new TypeError ( 'redirect rejected' );
        } );

        await expect ( retrieveSteamImage ( VALID_IMAGE_URL, fetchFunction ) ).rejects.toMatchObject (
            {
                code:   'STEAM_IMAGE_UNAVAILABLE',
                status: 502,
            },
        );
    } );
} );
