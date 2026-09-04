//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-04
// Author:  Rohin Gosling
//
// Description:
//
//   Verifies screenshot filenames, row-safe fallback partitioning, PNG structure, image routing, and published UI
//   composition without requiring a browser canvas in ordinary unit tests.
//---------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGameBannerController } from '../public/js/banner-view.js';
import {
    assemblePng,
    createImageFetchUrl,
    createNumberedScreenshotFileName,
    createScreenshotFileName,
    downloadPreparedScreenshotFile,
    drawAchievementIconsOnTile,
    inlineClonedImage,
    partitionRowsByHeight,
    readPngBlobBytes,
    ScreenshotExportError,
    waitForScreenshotFeedbackPaint,
} from '../public/js/screenshot-view.js';

const applicationSource = readFileSync ( new URL ( '../public/js/app.js', import.meta.url ), 'utf8' );
const componentsSource  = readFileSync ( new URL ( '../public/css/components.css', import.meta.url ), 'utf8' );
const indexSource       = readFileSync ( new URL ( '../public/index.html', import.meta.url ), 'utf8' );
const layoutSource      = readFileSync ( new URL ( '../public/css/layout.css', import.meta.url ), 'utf8' );
const screenshotSource  = readFileSync ( new URL ( '../public/js/screenshot-view.js', import.meta.url ), 'utf8' );
const tokensSource      = readFileSync ( new URL ( '../public/css/tokens.css', import.meta.url ), 'utf8' );

//---------------------------------------------------------------------------------------------------------------------
// Function: readUnsignedInteger
//
// Description:
//
//   Reads one unsigned 32-bit PNG field in network-byte order.
//
// Parameters:
//
// - bytes (Uint8Array):
//   The PNG bytes containing the field.
//
// - offset (number):
//   The field offset in bytes.
//
// Returns:
//
//   The unsigned 32-bit value in network-byte order.
//
//---------------------------------------------------------------------------------------------------------------------

function readUnsignedInteger ( bytes, offset )
{
    return new DataView ( bytes.buffer, bytes.byteOffset, bytes.byteLength ).getUint32 ( offset, false );
}

//---------------------------------------------------------------------------------------------------------------------
// Class: FakeImageElement
//
// Description:
//
//   Provides the image, event, and ancestry behavior needed to exercise banner screenshot fallback without a browser
//   canvas.
//
//---------------------------------------------------------------------------------------------------------------------

class FakeImageElement
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a fake image or banner-supporting element.
    //
    // Parameters:
    //
    // - className (string):
    //   Optional CSS class represented by the element.
    //
    //-----------------------------------------------------------------------------------------------------------------

    constructor ( className = '' )
    {
        const classNames = new Set ( className.length > 0 ? [ className ] : [] );

        this.alt            = '';
        this.attributes     = new Map ();
        this.card           = null;
        this.classList      = { contains: candidate => classNames.has ( candidate ) };
        this.decoding       = 'auto';
        this.hidden         = false;
        this.hiddenAncestor = null;
        this.listeners      = new Map ();
        this.naturalHeight  = 16;
        this.naturalWidth   = 16;
        this.parentElement  = null;
        this.textContent    = '';
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Value Accessor: currentSrc
    //-----------------------------------------------------------------------------------------------------------------

    get currentSrc ()
    {
        return this.getAttribute ( 'src' ) ?? '';
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Value Accessor: src
    //-----------------------------------------------------------------------------------------------------------------

    get src ()
    {
        return this.currentSrc;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Mutator: src
    //-----------------------------------------------------------------------------------------------------------------

    set src ( value )
    {
        this.setAttribute ( 'src', value );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: addEventListener
    //-----------------------------------------------------------------------------------------------------------------

    addEventListener ( eventName, listener )
    {
        this.listeners.set ( eventName, listener );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: closest
    //-----------------------------------------------------------------------------------------------------------------

    closest ( selector )
    {
        if ( selector === '[hidden]' )
        {
            return this.hiddenAncestor;
        }

        if ( selector === '.achievement-card' )
        {
            return this.card;
        }

        return null;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: decode
    //-----------------------------------------------------------------------------------------------------------------

    decode ()
    {
        return Promise.resolve ();
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: dispatch
    //-----------------------------------------------------------------------------------------------------------------

    dispatch ( eventName )
    {
        this.listeners.get ( eventName )?. ();
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: getAttribute
    //-----------------------------------------------------------------------------------------------------------------

    getAttribute ( attributeName )
    {
        return this.attributes.get ( attributeName ) ?? null;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: removeAttribute
    //-----------------------------------------------------------------------------------------------------------------

    removeAttribute ( attributeName )
    {
        this.attributes.delete ( attributeName );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: setAttribute
    //-----------------------------------------------------------------------------------------------------------------

    setAttribute ( attributeName, attributeValue )
    {
        this.attributes.set ( attributeName, attributeValue );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: FakeFileReader
//
// Description:
//
//   Converts fetched test image Blobs to a deterministic data URL for cloned-image decoding.
//
//---------------------------------------------------------------------------------------------------------------------

class FakeFileReader
{
    constructor ()
    {
        this.error     = null;
        this.listeners = new Map ();
        this.result    = null;
    }

    addEventListener ( eventName, listener )
    {
        this.listeners.set ( eventName, listener );
    }

    abort ()
    {
        return undefined;
    }

    readAsDataURL ( blob )
    {
        this.result = `data:${blob.type};base64,dGVzdA==`;
        queueMicrotask ( () => this.listeners.get ( 'load' )?. () );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createBannerFixture
//
// Description:
//
//   Creates a loaded Library Hero and Library Logo with ordered Store and logo fallback candidates.
//
// Returns:
//
//   The controller-backed source elements used by screenshot fallback tests.
//
//---------------------------------------------------------------------------------------------------------------------

function createBannerFixture ()
{
    const artwork         = new FakeImageElement ();
    const fallback        = new FakeImageElement ();
    const fallbackLogo    = new FakeImageElement ();
    const fallbackText    = new FakeImageElement ();
    const fallbackVersion = new FakeImageElement ();
    const gameLogo        = new FakeImageElement ( 'banner-header__game-logo' );
    const image           = new FakeImageElement ( 'banner-header__image' );
    const controller      = createGameBannerController (
        artwork,
        image,
        gameLogo,
        fallback,
        fallbackLogo,
        fallbackText,
        fallbackVersion,
    );

    controller.render (
        {
            bannerUrls:
            [
                'https://cdn.example/library_hero.jpg',
                'https://cdn.example/header.jpg',
                'https://cdn.example/capsule.jpg',
            ],
            iconUrl:         'https://cdn.example/icon.jpg',
            libraryLogoUrls:
            [
                'https://cdn.example/logo_2x.png',
                'https://cdn.example/logo.png',
            ],
            name:            'Portal 2',
        },
    );
    image.dispatch ( 'load' );
    gameLogo.dispatch ( 'load' );

    return { artwork, fallback, gameLogo, image };
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createClonedBannerFixture
//
// Description:
//
//   Creates a screenshot-clone banner whose presentation can be inspected after candidate selection.
//
// Returns:
//
//   The clone card and its artwork elements.
//
//---------------------------------------------------------------------------------------------------------------------

function createClonedBannerFixture ()
{
    const artwork  = new FakeImageElement ();
    const fallback = new FakeImageElement ();
    const gameLogo = new FakeImageElement ( 'banner-header__game-logo' );
    const image    = new FakeImageElement ( 'banner-header__image' );
    const card     =
    {
        querySelector: selector =>
        (
            {
                '.banner-header__artwork': artwork,
                '.banner-header__fallback': fallback,
                '.banner-header__game-logo': gameLogo,
            } [ selector ] ?? null
        ),
    };

    artwork.hidden  = false;
    fallback.hidden = true;
    gameLogo.hidden = false;
    image.hidden    = false;
    artwork.setAttribute ( 'data-artwork-kind', 'library-hero' );
    gameLogo.setAttribute ( 'src', 'https://cdn.example/logo_2x.png' );
    image.setAttribute ( 'src', 'https://cdn.example/library_hero.jpg' );
    gameLogo.card = card;
    image.card    = card;

    return { artwork, fallback, gameLogo, image };
}

//---------------------------------------------------------------------------------------------------------------------
// Function: installScreenshotImageGlobals
//
// Description:
//
//   Installs the browser globals required by the screenshot image-fetch and Blob-inlining path.
//
//---------------------------------------------------------------------------------------------------------------------

function installScreenshotImageGlobals ()
{
    vi.stubGlobal ( 'FileReader', FakeFileReader );
    vi.stubGlobal (
        'window',
        {
            clearTimeout,
            location:
            {
                href:   'https://example.test/',
                origin: 'https://example.test',
            },
            setTimeout,
        },
    );
}

afterEach ( () =>
{
    vi.useRealTimers ();
    vi.unstubAllGlobals ();
} );

describe ( 'Achievement screenshot export', () =>
{
    it ( 'stacks equal-sized Change User and Screenshot buttons in the hero banner', () =>
    {
        const actionGroupIndex = indexSource.indexOf ( 'class="banner-header__actions"' );
        const changeUserIndex  = indexSource.indexOf ( 'id="change-user"' );
        const screenshotIndex  = indexSource.indexOf ( 'id="save-achievement-screenshot"' );
        const controlBarIndex  = indexSource.indexOf ( 'class="achievement-card__block control-bar"' );

        expect ( actionGroupIndex ).toBeGreaterThan ( 0 );
        expect ( changeUserIndex ).toBeGreaterThan ( actionGroupIndex );
        expect ( screenshotIndex ).toBeGreaterThan ( changeUserIndex );
        expect ( controlBarIndex ).toBeGreaterThan ( screenshotIndex );
        expect ( indexSource ).toContain ( 'type="button">Change User</button>' );
        expect ( indexSource ).toContain ( 'disabled>Screenshot</button>' );
        expect ( indexSource ).not.toContain ( '📷' );
        expect ( tokensSource ).toContain ( '--banner-action-width        : 104px;' );
        expect ( tokensSource ).toContain ( '--banner-action-opacity      : 0.70;' );
        expect ( layoutSource ).toContain ( 'gap                : var( --banner-action-inset );' );
        expect ( componentsSource ).toContain ( 'width            : var( --banner-action-width );' );
        expect ( componentsSource ).toContain ( 'height           : var( --control-height );' );
        expect ( componentsSource ).toContain ( 'opacity          : var( --banner-action-opacity );' );
    } );

    it ( 'provides an accessible responsive screenshot progress dialog outside the exported card', () =>
    {
        const footerIndex      = indexSource.indexOf ( 'class="achievement-card__footer"' );
        const dialogIndex      = indexSource.indexOf ( 'id="screenshot-progress-dialog"' );
        const liveRegionIndex  = indexSource.indexOf ( 'id="application-status"' );
        const dialogMarkup     = indexSource.slice ( dialogIndex, indexSource.indexOf ( '</dialog>', dialogIndex ) );

        expect ( dialogIndex ).toBeGreaterThan ( footerIndex );
        expect ( dialogIndex ).toBeLessThan ( liveRegionIndex );
        expect ( indexSource ).toContain ( 'aria-labelledby="screenshot-progress-title"' );
        expect ( indexSource ).toContain ( 'aria-describedby="screenshot-progress-message"' );
        expect ( indexSource ).toContain ( 'id="screenshot-progress-title"' );
        expect ( indexSource ).toContain ( 'tabindex="-1">Generating screenshot</h2>' );
        expect ( indexSource ).toContain ( 'id="screenshot-progress-stage">Stage 1 of 5</p>' );
        expect ( indexSource ).toContain ( 'id="screenshot-progress-bar"' );
        expect ( dialogMarkup ).toContain ( 'id="screenshot-progress-announcement"' );
        expect ( dialogMarkup ).toContain ( 'role="status"' );
        expect ( dialogMarkup ).toContain ( 'aria-live="polite"' );
        expect ( dialogMarkup ).toContain ( 'aria-atomic="true"></p>' );
        expect ( dialogMarkup ).not.toContain ( 'aria-busy=' );
        expect ( indexSource ).not.toContain ( 'id="screenshot-progress-dialog" open' );
        expect ( tokensSource ).toContain ( '--screenshot-progress-width  : 424px;' );
        expect ( layoutSource ).toContain ( '.screenshot-progress-dialog' );
        expect ( layoutSource ).toContain ( 'max-height : calc( 100dvh - ( 4 * var( --gap ) ) );' );
        expect ( componentsSource ).toContain ( '.screenshot-progress-dialog::backdrop' );
        expect ( componentsSource ).toContain ( '.screenshot-progress-dialog__bar::-webkit-progress-value' );
        expect ( componentsSource ).toContain ( '.screenshot-progress-dialog__bar::-moz-progress-bar' );
        expect ( applicationSource ).toContain ( "from './screenshot-progress-view.js';" );
    } );

    it ( 'defines a native 960px export without scrollbars, overlaid hero actions, or the live GitHub footer', () =>
    {
        expect ( tokensSource ).toContain ( '--screenshot-width           : var( --card-width );' );
        expect ( screenshotSource ).toContain ( 'const SCREENSHOT_WIDTH                  = 960;' );
        expect ( layoutSource ).toContain ( 'scrollbar-width  : none;' );
        expect ( layoutSource ).toContain ( 'scrollbar-gutter : auto;' );
        expect ( screenshotSource ).toContain (
            "clonedCard.querySelector ( '.banner-header__actions' )?.remove ();",
        );
        expect ( screenshotSource ).toContain (
            "clonedCard.querySelector ( '.achievement-card__footer' )?.remove ();",
        );
        expect ( layoutSource ).toContain ( 'padding-bottom : var( --gap );' );
    } );

    it ( 'renders checked screenshot checkboxes with a real check-mark element', () =>
    {
        expect ( screenshotSource ).toContain ( 'function createScreenshotCheckboxMark ()' );
        expect ( screenshotSource ).toContain ( "document.createElementNS ( SVG_NAMESPACE, 'svg' )" );
        expect ( screenshotSource ).toContain ( "path.setAttribute ( 'd', 'M4 8.25L6.75 11L12 5' );" );
        expect ( screenshotSource ).toContain ( 'replacement.append ( createScreenshotCheckboxMark () );' );
        expect ( componentsSource ).toContain ( '.screenshot-checkbox__mark' );
        expect ( componentsSource ).toContain ( '.screenshot-checkbox__mark-path' );
        expect ( componentsSource ).not.toContain ( '.screenshot-checkbox[data-checked="true"]::after' );
    } );

    it ( 'creates safe single and numbered PNG filenames', () =>
    {
        expect ( createScreenshotFileName ( 'Portal 2™' ) ).toBe ( 'portal-2tm-achievements.png' );
        expect ( createScreenshotFileName ( '  /:*?  ' ) ).toBe ( 'steam-achievements.png' );
        expect ( createNumberedScreenshotFileName ( 'portal-2-achievements.png', 2, 12 ) ).toBe (
            'portal-2-achievements-part-02-of-12.png',
        );
    } );

    it ( 'keeps every fallback row whole and in source order', () =>
    {
        expect ( partitionRowsByHeight ( [ 80, 80, 80, 80 ], 170, 8 ) ).toEqual (
            [
                { end: 2, start: 0 },
                { end: 4, start: 2 },
            ],
        );
        expect ( partitionRowsByHeight ( [], 170, 8 ) ).toEqual ( [ { end: 0, start: 0 } ] );
    } );

    it ( 'assembles the required PNG signature and 960px image header', async () =>
    {
        const pngBlob = assemblePng ( 960, 5000, new Uint8Array ( [ 120, 156, 3, 0, 0, 0, 0, 1 ] ) );
        const bytes   = new Uint8Array ( await pngBlob.arrayBuffer () );

        expect ( [ ...bytes.subarray ( 0, 8 ) ] ).toEqual ( [ 137, 80, 78, 71, 13, 10, 26, 10 ] );
        expect ( new TextDecoder ().decode ( bytes.subarray ( 12, 16 ) ) ).toBe ( 'IHDR' );
        expect ( readUnsignedInteger ( bytes, 16 ) ).toBe ( 960 );
        expect ( readUnsignedInteger ( bytes, 20 ) ).toBe ( 5000 );
        expect ( new TextDecoder ().decode ( bytes.subarray ( bytes.length - 8, bytes.length - 4 ) ) ).toBe ( 'IEND' );
        expect ( pngBlob.type ).toBe ( 'image/png' );
    } );

    it ( 'rejects empty or non-PNG encoder output before saving', async () =>
    {
        await expect ( readPngBlobBytes ( new Blob ( [], { type: 'image/png' } ) ) ).rejects.toBeInstanceOf (
            ScreenshotExportError,
        );
        await expect (
            readPngBlobBytes ( new Blob ( [ new Uint8Array ( [ 1, 2, 3 ] ) ], { type: 'image/png' } ) ),
        ).rejects.toBeInstanceOf ( ScreenshotExportError );
    } );

    it ( 'materializes validated PNG bytes before crossing the file writer boundary', async () =>
    {
        const pngBlob = assemblePng ( 960, 1200, new Uint8Array ( [ 120, 156, 3, 0, 0, 0, 0, 1 ] ) );
        const bytes   = await readPngBlobBytes ( pngBlob );

        expect ( [ ...bytes.subarray ( 0, 8 ) ] ).toEqual ( [ 137, 80, 78, 71, 13, 10, 26, 10 ] );
        expect ( readUnsignedInteger ( bytes, 16 ) ).toBe ( 960 );
        expect ( readUnsignedInteger ( bytes, 20 ) ).toBe ( 1200 );
    } );

    it ( 'bounds a stalled encoder-output read so the export lifecycle can recover', async () =>
    {
        vi.useFakeTimers ();

        const readTask = readPngBlobBytes (
            { arrayBuffer: () => new Promise ( () => undefined ) },
        );
        const rejection = expect ( readTask ).rejects.toThrow ( 'could not be read in time' );

        await vi.advanceTimersByTimeAsync ( 30_000 );
        await rejection;
    } );

    it ( 'uses same-origin images directly and proxies cross-origin Steam images', () =>
    {
        vi.stubGlobal (
            'window',
            {
                location:
                {
                    href:   'https://example.test/',
                    origin: 'https://example.test',
                },
            },
        );

        expect ( createImageFetchUrl ( '/images/ui/steam-logo.jpg' ) ).toBe (
            'https://example.test/images/ui/steam-logo.jpg',
        );
        expect ( createImageFetchUrl ( 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg' ) ).toBe (
            'https://example.test/api/images?url='
                + 'https%3A%2F%2Fcdn.cloudflare.steamstatic.com%2Fsteam%2Fapps%2F620%2Fheader.jpg',
        );
        expect (
            createImageFetchUrl (
                'https://media.steampowered.com/steamcommunity/public/images/apps/620/icon.jpg',
            ),
        ).toBe (
            'https://example.test/api/images?url='
                + 'https%3A%2F%2Fmedia.steampowered.com%2Fsteamcommunity%2Fpublic%2Fimages%2Fapps%2F620%2Ficon.jpg',
        );
        expect ( screenshotSource ).toContain ( "|| clonedImage.getAttribute ( 'src' );" );
        expect ( screenshotSource ).toContain ( 'const IMAGE_FETCH_ATTEMPTS              = 2;' );
        expect ( screenshotSource ).toContain ( 'const IMAGE_INLINE_CONCURRENCY          = 3;' );
        expect ( screenshotSource ).toContain ( 'signal:  requestController.signal' );
        expect ( screenshotSource ).toContain ( 'await waitForImageRetry ( attemptIndex );' );
        expect ( screenshotSource ).toContain ( 'getBannerScreenshotCandidates ( sourceImage )' );
        expect ( screenshotSource ).toContain ( 'for ( const imageCandidate of imageCandidates )' );
        expect ( screenshotSource ).toContain ( 'fetchScreenshotImage ( imageCandidate.url )' );
        expect ( screenshotSource ).toContain ( 'applyClonedBannerCandidate ( clonedImage, imageCandidate )' );
        expect ( screenshotSource ).toContain ( "clonedImage.removeAttribute ( 'loading' );" );
        expect ( screenshotSource ).toContain ( "clonedImage.decoding = 'sync';" );
        expect ( screenshotSource ).toContain ( 'await waitForClonedImage ( clonedImage );' );
        expect ( screenshotSource ).toContain ( 'data:image/svg+xml;charset=utf-8' );
        expect ( screenshotSource ).toContain ( 'image.decode ()' );
    } );

    it ( 'uses the next Store artwork when the active Library Hero cannot be embedded', async () =>
    {
        const sourceFixture = createBannerFixture ();
        const clonedFixture = createClonedBannerFixture ();
        const fetchFunction = vi.fn ( async requestUrl =>
        {
            const upstreamUrl = new URL ( requestUrl ).searchParams.get ( 'url' );

            if ( upstreamUrl === 'https://cdn.example/library_hero.jpg' )
            {
                return new Response ( null, { status: 502 } );
            }

            return new Response ( new Blob ( [ 'store-header' ], { type: 'image/jpeg' } ), { status: 200 } );
        } );

        installScreenshotImageGlobals ();
        vi.stubGlobal ( 'fetch', fetchFunction );

        await inlineClonedImage ( sourceFixture.image, clonedFixture.image );

        const requestedUrls = fetchFunction.mock.calls.map (
            ( [ requestUrl ] ) => new URL ( requestUrl ).searchParams.get ( 'url' ),
        );

        expect ( requestedUrls ).toEqual (
            [
                'https://cdn.example/library_hero.jpg',
                'https://cdn.example/library_hero.jpg',
                'https://cdn.example/header.jpg',
            ],
        );
        expect ( clonedFixture.image.src ).toBe ( 'data:image/jpeg;base64,dGVzdA==' );
        expect ( clonedFixture.artwork.getAttribute ( 'data-artwork-kind' ) ).toBe ( 'fallback' );
        expect ( clonedFixture.artwork.hidden ).toBe ( false );
        expect ( clonedFixture.fallback.hidden ).toBe ( true );
        expect ( clonedFixture.gameLogo.hidden ).toBe ( true );
        expect ( clonedFixture.gameLogo.getAttribute ( 'src' ) ).toBeNull ();
    } );

    it ( 'retries transient Firefox data-URL decode failures without fetching the icon again', async () =>
    {
        const sourceImage   = new FakeImageElement ( 'achievement-row__icon' );
        const clonedImage   = new FakeImageElement ( 'achievement-row__icon' );
        const placeholder   = { hidden: true };
        const fetchFunction = vi.fn (
            async () => new Response ( new Blob ( [ 'icon' ], { type: 'image/png' } ), { status: 200 } ),
        );
        const decode = vi.fn ()
            .mockRejectedValueOnce ( new Error ( 'Transient Firefox decode failure.' ) )
            .mockRejectedValueOnce ( new Error ( 'Transient Firefox decode failure.' ) )
            .mockImplementationOnce ( async () =>
            {
                clonedImage.naturalHeight = 16;
                clonedImage.naturalWidth  = 16;
            } );

        sourceImage.setAttribute ( 'src', 'https://cdn.example/icon.png' );
        clonedImage.naturalHeight = 0;
        clonedImage.naturalWidth  = 0;
        clonedImage.parentElement = { querySelector: () => placeholder };
        clonedImage.decode        = decode;

        installScreenshotImageGlobals ();
        vi.stubGlobal ( 'fetch', fetchFunction );

        await inlineClonedImage ( sourceImage, clonedImage );

        expect ( decode ).toHaveBeenCalledTimes ( 3 );
        expect ( fetchFunction ).toHaveBeenCalledOnce ();
        expect ( clonedImage.src ).toBe ( 'data:image/png;base64,dGVzdA==' );
        expect ( clonedImage.hidden ).toBe ( false );
        expect ( placeholder.hidden ).toBe ( true );
    } );

    it ( 'bounds exhausted Firefox decode retries and applies the achievement icon fallback', async () =>
    {
        const sourceImage   = new FakeImageElement ( 'achievement-row__icon' );
        const clonedImage   = new FakeImageElement ( 'achievement-row__icon' );
        const placeholder   = { hidden: true };
        const fetchFunction = vi.fn (
            async () => new Response ( new Blob ( [ 'icon' ], { type: 'image/png' } ), { status: 200 } ),
        );
        const decode = vi.fn ( async () =>
        {
            throw new Error ( 'Persistent Firefox decode failure.' );
        } );

        sourceImage.setAttribute ( 'src', 'https://cdn.example/icon.png' );
        clonedImage.naturalHeight = 0;
        clonedImage.naturalWidth  = 0;
        clonedImage.parentElement = { querySelector: () => placeholder };
        clonedImage.decode        = decode;

        installScreenshotImageGlobals ();
        vi.stubGlobal ( 'fetch', fetchFunction );

        await inlineClonedImage ( sourceImage, clonedImage );

        expect ( decode ).toHaveBeenCalledTimes ( 3 );
        expect ( fetchFunction ).toHaveBeenCalledOnce ();
        expect ( clonedImage.hidden ).toBe ( true );
        expect ( clonedImage.getAttribute ( 'src' ) ).toBeNull ();
        expect ( placeholder.hidden ).toBe ( false );
    } );

    it ( 'hides an unavailable Library Logo without removing its valid Library Hero', async () =>
    {
        const sourceFixture = createBannerFixture ();
        const clonedFixture = createClonedBannerFixture ();
        const fetchFunction = vi.fn ( async () => new Response ( null, { status: 502 } ) );

        installScreenshotImageGlobals ();
        vi.stubGlobal ( 'fetch', fetchFunction );

        await inlineClonedImage ( sourceFixture.gameLogo, clonedFixture.gameLogo );

        const requestedUrls = fetchFunction.mock.calls.map (
            ( [ requestUrl ] ) => new URL ( requestUrl ).searchParams.get ( 'url' ),
        );

        expect ( requestedUrls ).toEqual (
            [
                'https://cdn.example/logo_2x.png',
                'https://cdn.example/logo_2x.png',
                'https://cdn.example/logo.png',
                'https://cdn.example/logo.png',
            ],
        );
        expect ( clonedFixture.gameLogo.hidden ).toBe ( true );
        expect ( clonedFixture.gameLogo.getAttribute ( 'src' ) ).toBeNull ();
        expect ( clonedFixture.image.hidden ).toBe ( false );
        expect ( clonedFixture.artwork.hidden ).toBe ( false );
        expect ( clonedFixture.artwork.getAttribute ( 'data-artwork-kind' ) ).toBe ( 'library-hero' );
    } );

    it ( 'opens the picker first but defers the native writable until validated PNG bytes exist', () =>
    {
        const pickerIndex   = screenshotSource.indexOf ( 'beginSaveFilePicker ( fileName )' );
        const firstAwait    = screenshotSource.indexOf ( 'await fileHandleRequest' );
        const progressIndex = screenshotSource.indexOf (
            "reportScreenshotProgress ( reportProgress, 1, 'Preparing screenshot layout…' );",
        );
        const paintIndex    = screenshotSource.indexOf ( 'await waitForScreenshotFeedbackPaint ();' );
        const stageIndex    = screenshotSource.indexOf ( 'stageData = createScreenshotStage ( sourceCard );' );
        const downloadIndex = screenshotSource.indexOf ( 'anchor.download = preparedFile.fileName' );
        const saveFunction  = screenshotSource.slice (
            screenshotSource.indexOf ( 'async function saveScreenshotFiles' ),
            screenshotSource.indexOf ( '// Function: captureAchievementScreenshot' ),
        );

        expect ( pickerIndex ).toBeGreaterThan ( 0 );
        expect ( firstAwait ).toBeGreaterThan ( pickerIndex );
        expect ( progressIndex ).toBeGreaterThan ( firstAwait );
        expect ( paintIndex ).toBeGreaterThan ( progressIndex );
        expect ( stageIndex ).toBeGreaterThan ( paintIndex );
        expect ( downloadIndex ).toBeGreaterThan ( 0 );
        expect ( saveFunction.indexOf ( 'readPngBlobBytes ( pngBlob )' ) ).toBeLessThan (
            saveFunction.indexOf ( 'writeFileHandle ( fileHandle' ),
        );
        expect ( screenshotSource ).toContain ( 'fileHandle.createWritable ()' );
        expect ( screenshotSource ).toContain ( 'writableFile.write ( pngBytes )' );
        expect ( screenshotSource ).toContain ( 'writableFile.close ()' );
        expect ( screenshotSource ).toContain ( 'await abortWritableFile ( writableFile );' );
        expect ( screenshotSource ).not.toContain ( 'createFileDestination' );
        expect ( screenshotSource ).toContain ( 'compressionWriter.releaseLock ();' );
        expect ( screenshotSource ).toContain ( 'nativeDestinationUnused: fileHandle !== null' );
        expect ( applicationSource ).toContain ( 'The selected single-file destination was not written' );
        expect ( screenshotSource ).toContain ( "new CompressionStream ( 'deflate' )" );
        expect ( screenshotSource ).toContain ( 'renderNumberedFallbackPngs' );
    } );

    it ( 'allows screenshot feedback to paint across two animation frames without an unbounded wait', async () =>
    {
        const animationFrameCallbacks = [];
        const clearTimeout             = vi.fn ();
        const setTimeout               = vi.fn ( () => 17 );

        vi.stubGlobal (
            'window',
            {
                clearTimeout,
                requestAnimationFrame: callback => animationFrameCallbacks.push ( callback ),
                setTimeout,
            },
        );

        const paintTask = waitForScreenshotFeedbackPaint ();

        expect ( animationFrameCallbacks ).toHaveLength ( 1 );

        animationFrameCallbacks.shift ()();

        expect ( animationFrameCallbacks ).toHaveLength ( 1 );

        animationFrameCallbacks.shift ()();
        await paintTask;

        expect ( setTimeout ).toHaveBeenCalledWith ( expect.any ( Function ), 250 );
        expect ( clearTimeout ).toHaveBeenCalledWith ( 17 );
    } );

    it ( 'starts one prepared fallback download and retains its Blob URL safely', () =>
    {
        const click       = vi.fn ();
        const remove      = vi.fn ();
        const append      = vi.fn ();
        const revoke      = vi.fn ();
        const setTimeout  = vi.fn ();
        const createUrl   = vi.fn ( () => 'blob:https://example.test/screenshot' );
        const anchor      = { click, download: '', href: '', remove };
        const pngBlob     = new Blob ( [ 'png' ], { type: 'image/png' } );

        vi.stubGlobal ( 'document', { body: { append }, createElement: () => anchor } );
        vi.stubGlobal ( 'URL', { createObjectURL: createUrl, revokeObjectURL: revoke } );
        vi.stubGlobal ( 'window', { setTimeout } );

        downloadPreparedScreenshotFile ( { blob: pngBlob, fileName: 'achievements.png' } );

        expect ( createUrl ).toHaveBeenCalledWith ( pngBlob );
        expect ( anchor.download ).toBe ( 'achievements.png' );
        expect ( anchor.href ).toBe ( 'blob:https://example.test/screenshot' );
        expect ( append ).toHaveBeenCalledWith ( anchor );
        expect ( click ).toHaveBeenCalledOnce ();
        expect ( remove ).toHaveBeenCalledOnce ();
        expect ( setTimeout ).toHaveBeenCalledWith ( expect.any ( Function ), 60_000 );
        expect ( revoke ).not.toHaveBeenCalled ();
    } );

    it ( 'draws decoded achievement icons directly onto their intersecting canvas tile', () =>
    {
        const createIcon = ( properties = {} ) =>
        (
            {
                complete:                true,
                hidden:                  false,
                naturalHeight:           64,
                naturalWidth:            64,
                closest:                 () => null,
                getBoundingClientRect:   () => ( { height: 64, left: 34, top: 550, width: 64 } ),
                ...properties,
            }
        );
        const visibleIcon        = createIcon ();
        const hiddenIcon         = createIcon ( { hidden: true } );
        const hiddenAncestorIcon = createIcon ( { closest: () => ( {} ) } );
        const emptyIcon          = createIcon ( { naturalWidth: 0 } );
        const outsideTileIcon    = createIcon (
            { getBoundingClientRect: () => ( { height: 64, left: 34, top: 950, width: 64 } ) },
        );
        const card    =
        {
            getBoundingClientRect: () => ( { left: 10, top: 100 } ),
            querySelectorAll: () => [ visibleIcon, hiddenIcon, hiddenAncestorIcon, emptyIcon, outsideTileIcon ],
        };
        const context =
        {
            drawImage:   vi.fn (),
            filter:      'none',
            globalAlpha: 1,
            restore:     vi.fn (),
            save:        vi.fn (),
        };

        vi.stubGlobal (
            'window',
            { getComputedStyle: () => ( { filter: 'grayscale(1)', opacity: '0.45' } ) },
        );

        drawAchievementIconsOnTile ( card, context, 400, 200 );

        expect ( context.save ).toHaveBeenCalledOnce ();
        expect ( context.drawImage ).toHaveBeenCalledWith ( visibleIcon, 24, 50, 64, 64 );
        expect ( context.globalAlpha ).toBe ( 0.45 );
        expect ( context.filter ).toBe ( 'grayscale(1)' );
        expect ( context.restore ).toHaveBeenCalledOnce ();
    } );

    it ( 'keeps the screenshot button enabled while a guarded export is in progress', () =>
    {
        const downloadFunction = applicationSource.slice (
            applicationSource.indexOf ( 'function downloadNextPreparedScreenshotFile' ),
            applicationSource.indexOf ( '// Function: saveAchievementScreenshot' ),
        );
        const saveFunction = applicationSource.slice (
            applicationSource.indexOf ( 'async function saveAchievementScreenshot' ),
            applicationSource.indexOf ( '// Function: returnToUserCard' ),
        );

        expect ( applicationSource ).toContain ( 'let isScreenshotExportInProgress  = false;' );
        expect ( saveFunction ).toContain ( 'if ( isScreenshotExportInProgress )' );
        expect ( saveFunction ).toContain ( 'A screenshot export is already in progress.' );
        expect ( saveFunction ).toContain ( 'if ( pendingScreenshotFiles.length > 0 )' );
        expect ( saveFunction ).toContain ( 'downloadNextPreparedScreenshotFile ();' );
        expect ( saveFunction ).toContain ( 'if ( !result.nativeDestinationUnused )' );
        expect ( downloadFunction ).toContain ( 'downloadPreparedScreenshotFile ( pendingFile );' );
        expect ( downloadFunction.indexOf ( 'downloadPreparedScreenshotFile ( pendingFile );' ) ).toBeLessThan (
            downloadFunction.indexOf ( 'pendingScreenshotFiles.shift ();' ),
        );
        expect ( downloadFunction ).toContain ( 'Downloaded ${pendingFile.fileName}' );
        expect ( saveFunction ).not.toContain ( 'Screenshot ready. Click Screenshot again to download.' );
        expect ( saveFunction ).toContain ( "screenshotControl.setAttribute ( 'aria-busy', 'true' );" );
        expect ( saveFunction ).toContain ( 'isScreenshotExportInProgress = false;' );
        expect ( saveFunction ).not.toContain ( 'screenshotControl.disabled = true;' );
        expect ( saveFunction ).not.toContain ( 'screenshotControl.disabled = applicationState' );
    } );

    it ( 'closes modal progress before publishing terminal status outside the dialog', () =>
    {
        const saveFunction = applicationSource.slice (
            applicationSource.indexOf ( 'async function saveAchievementScreenshot' ),
            applicationSource.indexOf ( '// Function: returnToUserCard' ),
        );
        const savedBranch = saveFunction.slice (
            saveFunction.indexOf ( "if ( result.kind === 'saved' )" ),
            saveFunction.indexOf ( "if ( result.kind === 'download-ready' )" ),
        );
        const unusedDestinationBranch = saveFunction.slice (
            saveFunction.indexOf ( 'const unusedDestinationMessage' ) - 100,
            saveFunction.indexOf ( 'catch ( error )' ),
        );

        expect ( savedBranch.indexOf ( 'progressController?.close ();' ) ).toBeLessThan (
            savedBranch.indexOf ( 'setApplicationStatus (' ),
        );
        expect ( unusedDestinationBranch.indexOf ( 'progressController?.close ();' ) ).toBeLessThan (
            unusedDestinationBranch.indexOf ( 'setApplicationStatus (' ),
        );
    } );

    it ( 'removes achievement icon payloads from SVG tiles before direct canvas compositing', () =>
    {
        const cloneFunction = screenshotSource.slice (
            screenshotSource.indexOf ( 'function createSvgTileCardClone' ),
            screenshotSource.indexOf ( '// Function: createSvgTileDataUrl' ),
        );
        const rasterizeFunction = screenshotSource.slice (
            screenshotSource.indexOf ( 'async function rasterizeScreenshotTile' ),
            screenshotSource.indexOf ( '// Function: createPngScanline' ),
        );

        expect ( cloneFunction ).toContain ( "achievementIcon.style.visibility = 'hidden';" );
        expect ( cloneFunction ).toContain ( "achievementIcon.removeAttribute ( 'src' );" );
        expect ( cloneFunction ).toContain ( "achievementIcon.removeAttribute ( 'srcset' );" );
        expect ( screenshotSource ).toContain ( 'await prepareFallbackPartAchievementIcons ( partCard );' );
        expect ( rasterizeFunction.indexOf ( 'context.drawImage ( image, 0, 0 );' ) ).toBeLessThan (
            rasterizeFunction.indexOf ( 'drawAchievementIconsOnTile ( card, context, verticalOffset, tileHeight );' ),
        );
    } );
} );
