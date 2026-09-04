//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for isolated best-effort Steam Store artwork retrieval and fallback behavior.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { createLibraryHeroUrl, createLibraryLogoUrls, getStoreArtwork } from '../src/steam/store';

describe ( 'Steam Store artwork adapter', () =>
{
    it ( 'preserves Store header and capsule artwork order and requests English United States metadata', async () =>
    {
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL ) => Response.json (
            {
                620:
                {
                    data:
                    {
                        capsule_image: 'https://cdn.example/capsule.jpg',
                        header_image:  'https://cdn.example/header.jpg',
                        name:          'Portal 2',
                    },
                    success: true,
                },
            },
        ) );
        const artwork = await getStoreArtwork ( 620, fetchFunction );
        const url     = fetchFunction.mock.calls [ 0 ]?.[ 0 ];

        expect ( artwork ).toEqual (
            {
                bannerUrls:
                [
                    'https://cdn.example/header.jpg',
                    'https://cdn.example/capsule.jpg',
                ],
                name: 'Portal 2',
            },
        );
        expect ( url ).toBeInstanceOf ( URL );

        if ( ! ( url instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Store adapter to call fetch with a URL.' );
        }

        expect ( url.origin ).toBe ( 'https://store.steampowered.com' );
        expect ( url.searchParams.get ( 'appids' ) ).toBe ( '620' );
        expect ( url.searchParams.get ( 'cc' ) ).toBe ( 'us' );
        expect ( url.searchParams.get ( 'l' ) ).toBe ( 'english' );
    } );

    it ( 'uses capsule artwork when header artwork is unavailable', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                620:
                {
                    data:    { capsule_image: 'https://cdn.example/capsule.jpg', name: 'Portal 2' },
                    success: true,
                },
            },
        ) );

        await expect ( getStoreArtwork ( 620, fetchFunction ) ).resolves.toEqual (
            {
                bannerUrls: [ 'https://cdn.example/capsule.jpg' ],
                name:       'Portal 2',
            },
        );
    } );

    it ( 'constructs the AppID-addressed Library Hero candidate', () =>
    {
        expect ( createLibraryHeroUrl ( 620 ) )
            .toBe ( 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_hero.jpg' );
        expect ( () => createLibraryHeroUrl ( 0 ) ).toThrow ( RangeError );
    } );

    it ( 'constructs high-resolution and standard AppID-addressed Library Logo candidates', () =>
    {
        expect ( createLibraryLogoUrls ( 620 ) ).toEqual (
            [
                'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo_2x.png',
                'https://cdn.cloudflare.steamstatic.com/steam/apps/620/logo.png',
            ],
        );
        expect ( () => createLibraryLogoUrls ( 0 ) ).toThrow ( RangeError );
    } );

    it.each (
        [
            [ 'network failure', vi.fn ( async () => Promise.reject ( new Error ( 'offline' ) ) ) ],
            [ 'unsuccessful response', vi.fn ( async () => new Response ( '', { status: 503 } ) ) ],
            [ 'malformed JSON', vi.fn ( async () => new Response ( 'not-json' ) ) ],
            [ 'negative Store result', vi.fn ( async () => Response.json ( { 620: { success: false } } ) ) ],
        ],
    ) ( 'degrades %s to no artwork', async ( _description, fetchFunction ) =>
    {
        await expect ( getStoreArtwork ( 620, fetchFunction ) ).resolves.toBeNull ();
    } );
} );
