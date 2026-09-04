//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/screenshot-view.js
//
// Description:
//   Captures the active achievement card at its native 960px width. The renderer preserves the current visible rows, controls,
//   identity, artwork fallback, and progress while omitting the change-user and screenshot buttons. Bounded canvas
//   tiles are streamed into one PNG; row-safe numbered PNGs are the emergency fallback.
//---------------------------------------------------------------------------------------------------------------------

import { getBannerScreenshotCandidates } from './banner-view.js';

const ACHIEVEMENT_ICON_SELECTOR         = '.achievement-row__icon';
const ACHIEVEMENT_LIST_SELECTOR         = '.achievement-list';
const CLEANUP_OPERATION_TIMEOUT         = 2_000;
const DOWNLOAD_URL_LIFETIME             = 60_000;
const ENCODER_OPERATION_TIMEOUT         = 30_000;
const FALLBACK_IMAGE_HEIGHT             = 3900;
const IMAGE_DECODE_ATTEMPTS             = 3;
const IMAGE_DECODE_RETRY_DELAY          = 100;
const IMAGE_FETCH_ATTEMPTS              = 2;
const IMAGE_FETCH_RETRY_DELAY           = 250;
const IMAGE_FETCH_TIMEOUT               = 12_000;
const IMAGE_INLINE_CONCURRENCY          = 3;
const IMAGE_INLINE_TIMEOUT              = 60_000;
const IMAGE_READY_TIMEOUT               = 12_000;
const PNG_MIME_TYPE                     = 'image/png';
const RENDER_TILE_HEIGHT                = 2048;
const RENDER_TILE_TIMEOUT               = 30_000;
const PNG_HEADER_BYTE_LENGTH            = 24;
const SAVE_OPERATION_TIMEOUT            = 60_000;
const SCREENSHOT_HEIGHT_LIMIT           = 0x7fffffff;
const SCREENSHOT_FEEDBACK_PAINT_TIMEOUT = 250;
const SCREENSHOT_PROGRESS_STAGE_COUNT   = 5;
const SCREENSHOT_WIDTH                  = 960;
const STEAM_IMAGE_PROXY_PATH            = '/api/images';
const SVG_NAMESPACE                     = 'http://www.w3.org/2000/svg';
const XML_NAMESPACE                     = 'http://www.w3.org/1999/xhtml';

const PNG_SIGNATURE = new Uint8Array ( [ 137, 80, 78, 71, 13, 10, 26, 10 ] );
const CRC_TABLE     = createCrcTable ();

//---------------------------------------------------------------------------------------------------------------------
// Class: ScreenshotExportError
//
// Description:
//
//   Represents a safe, user-facing screenshot export failure.
//---------------------------------------------------------------------------------------------------------------------

export class ScreenshotExportError extends Error
{
    constructor ( message )
    {
        super ( message );

        this.name = 'ScreenshotExportError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: waitForBoundedOperation
//
// Description:
//
//   Prevents a browser, encoder, or filesystem Promise from retaining the screenshot lifecycle indefinitely.
//
// Parameters:
//
// - operation (Promise):
//   The asynchronous work whose settlement is required.
//
// - timeoutMilliseconds (number):
//   The maximum time allowed for the work to settle.
//
// - timeoutMessage (string):
//   The safe failure message used when the time limit expires.
//
// - handleTimeout (Function):
//   Optional best-effort cancellation invoked before the timeout rejection.
//
// Returns:
//
//   A Promise resolving to the operation result.
//
//---------------------------------------------------------------------------------------------------------------------

function waitForBoundedOperation ( operation, timeoutMilliseconds, timeoutMessage, handleTimeout = () => undefined )
{
    return new Promise ( ( resolve, reject ) =>
    {
        let hasSettled = false;

        const timeoutId = setTimeout ( () =>
        {
            if ( hasSettled )
            {
                return;
            }

            hasSettled = true;

            try
            {
                handleTimeout ();
            }
            catch
            {
                // Timeout cancellation is best effort; the bounded rejection must still settle the caller.
            }

            reject ( new ScreenshotExportError ( timeoutMessage ) );
        }, timeoutMilliseconds );

        Promise.resolve ( operation ).then (
            value =>
            {
                if ( hasSettled )
                {
                    return;
                }

                hasSettled = true;
                clearTimeout ( timeoutId );
                resolve ( value );
            },
            error =>
            {
                if ( hasSettled )
                {
                    return;
                }

                hasSettled = true;
                clearTimeout ( timeoutId );
                reject ( error );
            },
        );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createScreenshotFileName
//
// Description:
//
//   Builds a filesystem-safe PNG filename from the selected game name.
//
// Parameters:
//
// - gameName (string):
//   The selected game name to include in the export filename.
//
// Returns:
//
//   A filesystem-safe PNG filename.
//
//---------------------------------------------------------------------------------------------------------------------

export function createScreenshotFileName ( gameName )
{
    const normalizedName = String ( gameName ?? '' )
        .normalize ( 'NFKD' )
        .replace ( /[\u0300-\u036f]/g, '' )
        .replace ( /[^a-zA-Z0-9]+/g, '-' )
        .replace ( /^-+|-+$/g, '' )
        .toLowerCase ();
    const safeName = normalizedName.length > 0 ? normalizedName : 'steam';

    return `${safeName}-achievements.png`;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createNumberedScreenshotFileName
//
// Description:
//
//   Adds a stable one-based part number to an emergency fallback filename.
//
// Parameters:
//
// - fileName (string):
//   The base PNG filename.
//
// - partNumber (number):
//   The one-based fallback part number.
//
// - partCount (number):
//   The complete number of fallback parts.
//
// Returns:
//
//   The numbered PNG filename.
//
//---------------------------------------------------------------------------------------------------------------------

export function createNumberedScreenshotFileName ( fileName, partNumber, partCount )
{
    const stem       = fileName.replace ( /\.png$/i, '' );
    const digitCount = Math.max ( 2, String ( partCount ).length );
    const partText   = String ( partNumber ).padStart ( digitCount, '0' );
    const countText  = String ( partCount ).padStart ( digitCount, '0' );

    return `${stem}-part-${partText}-of-${countText}.png`;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: partitionRowsByHeight
//
// Description:
//
//   Groups complete achievement rows within the available fallback-image height.
//
// Parameters:
//
// - rowHeights (number[]):
//   The measured height of each visible achievement row.
//
// - availableHeight (number):
//   The maximum row area available in one fallback image.
//
// - rowGap (number):
//   The vertical gap between consecutive rows.
//
// Returns:
//
//   Ordered start and end indices for row-safe image partitions.
//
//---------------------------------------------------------------------------------------------------------------------

export function partitionRowsByHeight ( rowHeights, availableHeight, rowGap )
{
    if ( rowHeights.length === 0 )
    {
        return [ { end: 0, start: 0 } ];
    }

    const partitions = [];
    let partitionHeight = 0;
    let partitionStart  = 0;

    rowHeights.forEach ( ( rowHeight, rowIndex ) =>
    {
        const additionalHeight = partitionHeight === 0 ? rowHeight : rowGap + rowHeight;

        if ( partitionHeight > 0 && partitionHeight + additionalHeight > availableHeight )
        {
            partitions.push ( { end: rowIndex, start: partitionStart } );
            partitionHeight = rowHeight;
            partitionStart  = rowIndex;

            return;
        }

        partitionHeight += additionalHeight;
    } );

    partitions.push ( { end: rowHeights.length, start: partitionStart } );

    return partitions;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: reportScreenshotProgress
//
// Description:
//
//   Sends one structured workflow stage to the optional application progress view without coupling capture success to
//   presentation code.
//
// Parameters:
//
// - reportProgress (Function):
//   The optional application callback receiving screenshot stage reports.
//
// - stageNumber (number):
//   The current one-based workflow stage.
//
// - message (string):
//   The exact work currently in progress.
//
// - stageComplete (boolean):
//   Whether the current stage has finished and may advance the completed-stage bar.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function reportScreenshotProgress ( reportProgress, stageNumber, message, stageComplete = false )
{
    try
    {
        reportProgress (
            {
                message,
                stageComplete,
                stageNumber,
                totalStages: SCREENSHOT_PROGRESS_STAGE_COUNT,
            },
        );
    }
    catch
    {
        // Screenshot creation must remain usable if optional presentation feedback fails.
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: waitForScreenshotFeedbackPaint
//
// Description:
//
//   Gives the browser one complete paint between opening progress and beginning expensive clone/image work. A bounded
//   timer prevents background-tab animation-frame throttling from stalling the export.
//
// Returns:
//
//   A Promise that settles after two animation frames or the short fallback timeout.
//
//---------------------------------------------------------------------------------------------------------------------

export function waitForScreenshotFeedbackPaint ()
{
    if ( typeof window.requestAnimationFrame !== 'function' )
    {
        return Promise.resolve ();
    }

    return new Promise ( resolve =>
    {
        let hasSettled = false;
        let timeoutId  = null;

        const settle = () =>
        {
            if ( hasSettled )
            {
                return;
            }

            hasSettled = true;
            if ( timeoutId !== null )
            {
                window.clearTimeout ( timeoutId );
            }

            resolve ();
        };

        timeoutId = window.setTimeout ( settle, SCREENSHOT_FEEDBACK_PAINT_TIMEOUT );

        window.requestAnimationFrame ( () =>
        {
            window.requestAnimationFrame ( settle );
        } );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createCrcTable
//
// Description:
//
//   Creates the PNG CRC-32 lookup table.
// Returns:
//
//   The lookup table used for PNG CRC-32 checksums.
//
//---------------------------------------------------------------------------------------------------------------------

function createCrcTable ()
{
    const table = new Uint32Array ( 256 );

    for ( let tableIndex = 0; tableIndex < table.length; tableIndex += 1 )
    {
        let checksum = tableIndex;

        for ( let bitIndex = 0; bitIndex < 8; bitIndex += 1 )
        {
            checksum = ( checksum & 1 ) !== 0
                ? 0xedb88320 ^ ( checksum >>> 1 )
                : checksum >>> 1;
        }

        table [ tableIndex ] = checksum >>> 0;
    }

    return table;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: calculateCrc
//
// Description:
//
//   Calculates one PNG chunk CRC-32 value.
//
// Parameters:
//
// - bytes (Uint8Array):
//   The chunk type and data bytes to checksum.
//
// Returns:
//
//   The unsigned PNG CRC-32 checksum.
//
//---------------------------------------------------------------------------------------------------------------------

function calculateCrc ( bytes )
{
    let checksum = 0xffffffff;

    bytes.forEach ( byte =>
    {
        checksum = CRC_TABLE [ ( checksum ^ byte ) & 0xff ] ^ ( checksum >>> 8 );
    } );

    return ( checksum ^ 0xffffffff ) >>> 0;
}
//---------------------------------------------------------------------------------------------------------------------
// Function: writeUnsignedInteger
//
// Description:
//
//   Writes one unsigned 32-bit integer in PNG network-byte order.
//
// Parameters:
//
// - bytes (Uint8Array):
//   The destination byte array.
//
// - offset (number):
//   The destination byte offset.
//
// - value (number):
//   The unsigned value to write.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function writeUnsignedInteger ( bytes, offset, value )
{
    new DataView ( bytes.buffer, bytes.byteOffset, bytes.byteLength ).setUint32 ( offset, value, false );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createPngChunk
//
// Description:
//
//   Creates a length-prefixed and checksummed PNG chunk.
//
// Parameters:
//
// - chunkType (string):
//   The four-character PNG chunk type.
//
// - chunkData (Uint8Array):
//   The chunk payload bytes.
//
// Returns:
//
//   A length-prefixed PNG chunk with its CRC-32 checksum.
//
//---------------------------------------------------------------------------------------------------------------------

function createPngChunk ( chunkType, chunkData )
{
    const typeBytes = new TextEncoder ().encode ( chunkType );
    const chunk     = new Uint8Array ( 12 + chunkData.length );

    writeUnsignedInteger ( chunk, 0, chunkData.length );
    chunk.set ( typeBytes, 4 );
    chunk.set ( chunkData, 8 );
    writeUnsignedInteger (
        chunk,
        chunk.length - 4,
        calculateCrc ( chunk.subarray ( 4, chunk.length - 4 ) ),
    );

    return chunk;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createPngHeader
//
// Description:
//
//   Creates an 8-bit RGBA PNG image header.
//
// Parameters:
//
// - width (number):
//   The image width in pixels.
//
// - height (number):
//   The image height in pixels.
//
// Returns:
//
//   The complete PNG IHDR chunk.
//
//---------------------------------------------------------------------------------------------------------------------

function createPngHeader ( width, height )
{
    const header = new Uint8Array ( 13 );

    writeUnsignedInteger ( header, 0, width );
    writeUnsignedInteger ( header, 4, height );
    header [ 8 ]  = 8;
    header [ 9 ]  = 6;
    header [ 10 ] = 0;
    header [ 11 ] = 0;
    header [ 12 ] = 0;

    return createPngChunk ( 'IHDR', header );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: assemblePng
//
// Description:
//
//   Assembles a complete PNG from already deflated scanline data.
//
// Parameters:
//
// - width (number):
//   The image width in pixels.
//
// - height (number):
//   The image height in pixels.
//
// - compressedScanlines (Uint8Array):
//   The deflated filter-prefixed RGBA scanlines.
//
// Returns:
//
//   A complete PNG Blob.
//
//---------------------------------------------------------------------------------------------------------------------

export function assemblePng ( width, height, compressedScanlines )
{
    return new Blob (
        [
            PNG_SIGNATURE,
            createPngHeader ( width, height ),
            createPngChunk ( 'IDAT', compressedScanlines ),
            createPngChunk ( 'IEND', new Uint8Array () ),
        ],
        { type: PNG_MIME_TYPE },
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: hasPngSignature
//
// Description:
//
//   Verifies that the supplied bytes begin with the required PNG file signature.
//
// Parameters:
//
// - bytes (Uint8Array):
//   The candidate PNG bytes to validate.
//
// Returns:
//
//   Whether the supplied bytes carry the PNG signature.
//
//---------------------------------------------------------------------------------------------------------------------

function hasPngSignature ( bytes )
{
    if ( bytes.length < PNG_SIGNATURE.length )
    {
        return false;
    }

    for ( let byteIndex = 0; byteIndex < PNG_SIGNATURE.length; byteIndex += 1 )
    {
        if ( bytes [ byteIndex ] !== PNG_SIGNATURE [ byteIndex ] )
        {
            return false;
        }
    }

    return true;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: readPngBlobBytes
//
// Description:
//
//   Materializes and validates encoded PNG bytes before they cross the browser save boundary.
//
// Parameters:
//
// - pngBlob (Blob):
//   The encoded PNG image produced by the screenshot renderer.
//
// Returns:
//
//   The validated PNG bytes.
//
//---------------------------------------------------------------------------------------------------------------------

export async function readPngBlobBytes ( pngBlob )
{
    const pngArrayBuffer = await waitForBoundedOperation (
        pngBlob.arrayBuffer (),
        ENCODER_OPERATION_TIMEOUT,
        'The screenshot encoder output could not be read in time.',
    );
    const pngBytes = new Uint8Array ( pngArrayBuffer );

    if ( pngBytes.byteLength < PNG_HEADER_BYTE_LENGTH || !hasPngSignature ( pngBytes ) )
    {
        throw new ScreenshotExportError ( 'The screenshot encoder produced an invalid PNG.' );
    }

    return pngBytes;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: replaceSelectControls
//
// Description:
//
//   Replaces cloned selects with deterministic static equivalents preserving the current visible option.
//
// Parameters:
//
// - sourceCard (HTMLElement):
//   The live card containing the current select values.
//
// - clonedCard (HTMLElement):
//   The detached export clone to make non-interactive.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function replaceSelectControls ( sourceCard, clonedCard )
{
    const sourceControls = [ ...sourceCard.querySelectorAll ( 'select' ) ];
    const clonedControls = [ ...clonedCard.querySelectorAll ( 'select' ) ];

    clonedControls.forEach ( ( clonedControl, controlIndex ) =>
    {
        const sourceControl = sourceControls [ controlIndex ];
        const replacement   = document.createElement ( 'div' );
        const value          = document.createElement ( 'span' );

        replacement.className = `${clonedControl.className} screenshot-select`;
        value.className        = 'screenshot-select__value';
        value.textContent      = sourceControl?.selectedOptions [ 0 ]?.textContent ?? '';
        replacement.append ( value );
        clonedControl.replaceWith ( replacement );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createScreenshotCheckboxMark
//
// Description:
//
//   Creates the actual vector mark used by checked screenshot checkboxes. A serialized SVG path survives the
//   foreign-object rasterization path more reliably than a pseudo-element or transformed CSS border.
//
// Returns:
//
//   The SVG check mark element.
//
//---------------------------------------------------------------------------------------------------------------------

function createScreenshotCheckboxMark ()
{
    const mark = document.createElementNS ( SVG_NAMESPACE, 'svg' );
    const path = document.createElementNS ( SVG_NAMESPACE, 'path' );

    mark.setAttribute ( 'class', 'screenshot-checkbox__mark' );
    mark.setAttribute ( 'viewBox', '0 0 16 16' );
    mark.setAttribute ( 'aria-hidden', 'true' );
    mark.setAttribute ( 'focusable', 'false' );

    path.setAttribute ( 'class', 'screenshot-checkbox__mark-path' );
    path.setAttribute ( 'd', 'M4 8.25L6.75 11L12 5' );
    path.setAttribute ( 'fill', 'none' );
    path.setAttribute ( 'stroke', '#ffffff' );
    path.setAttribute ( 'stroke-linecap', 'round' );
    path.setAttribute ( 'stroke-linejoin', 'round' );
    path.setAttribute ( 'stroke-width', '2.25' );

    mark.append ( path );

    return mark;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: replaceCheckboxControls
//
// Description:
//
//   Replaces cloned checkboxes with deterministic static boxes preserving their current checked state.
//
// Parameters:
//
// - sourceCard (HTMLElement):
//   The live card containing the current checkbox state.
//
// - clonedCard (HTMLElement):
//   The detached export clone to make non-interactive.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function replaceCheckboxControls ( sourceCard, clonedCard )
{
    const sourceControls = [ ...sourceCard.querySelectorAll ( 'input[type="checkbox"]' ) ];
    const clonedControls = [ ...clonedCard.querySelectorAll ( 'input[type="checkbox"]' ) ];

    clonedControls.forEach ( ( clonedControl, controlIndex ) =>
    {
        const sourceControl = sourceControls [ controlIndex ];
        const replacement   = document.createElement ( 'span' );
        const isChecked     = sourceControl?.checked === true;

        replacement.className       = `${clonedControl.className} screenshot-checkbox`;
        replacement.dataset.checked = String ( isChecked );

        if ( isChecked )
        {
            replacement.append ( createScreenshotCheckboxMark () );
        }

        clonedControl.replaceWith ( replacement );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: replaceProgressControls
//
// Description:
//
//   Replaces cloned progress elements with deterministic tracks preserving the current completion ratio.
//
// Parameters:
//
// - sourceCard (HTMLElement):
//   The live card containing the current progress value.
//
// - clonedCard (HTMLElement):
//   The detached export clone to make deterministic.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function replaceProgressControls ( sourceCard, clonedCard )
{
    const sourceControls = [ ...sourceCard.querySelectorAll ( 'progress' ) ];
    const clonedControls = [ ...clonedCard.querySelectorAll ( 'progress' ) ];

    clonedControls.forEach ( ( clonedControl, controlIndex ) =>
    {
        const sourceControl = sourceControls [ controlIndex ];
        const replacement   = document.createElement ( 'div' );
        const value         = document.createElement ( 'div' );
        const maximum       = Number ( sourceControl?.max ?? 1 );
        const current       = Number ( sourceControl?.value ?? 0 );
        const percentage    = maximum > 0 ? Math.max ( 0, Math.min ( 100, ( current / maximum ) * 100 ) ) : 0;

        replacement.className = `${clonedControl.className} screenshot-progress`;
        value.className        = 'screenshot-progress__value';
        value.style.width      = `${percentage}%`;
        replacement.append ( value );
        clonedControl.replaceWith ( replacement );
    } );
}
//---------------------------------------------------------------------------------------------------------------------
// Function: removeCloneIdentifiers
//
// Description:
//
//   Removes duplicate identifiers and interactive relationships from the non-interactive export clone.
//
// Parameters:
//
// - clonedCard (HTMLElement):
//   The detached non-interactive export clone.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function removeCloneIdentifiers ( clonedCard )
{
    clonedCard.querySelectorAll ( '[id]' ).forEach ( element => element.removeAttribute ( 'id' ) );
    clonedCard.querySelectorAll ( '[for]' ).forEach ( element => element.removeAttribute ( 'for' ) );
    clonedCard.querySelectorAll ( '[tabindex]' ).forEach ( element => element.removeAttribute ( 'tabindex' ) );
    clonedCard.querySelectorAll ( '[aria-describedby]' ).forEach (
        element => element.removeAttribute ( 'aria-describedby' ),
    );
    clonedCard.querySelectorAll ( '[aria-labelledby]' ).forEach (
        element => element.removeAttribute ( 'aria-labelledby' ),
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createScreenshotStage
//
// Description:
//
//   Creates and attaches the isolated native-width export clone used for measurement and rasterization.
//
// Parameters:
//
// - sourceCard (HTMLElement):
//   The active achievement card to clone.
//
// Returns:
//
//   The detached stage and cloned card used for export rendering.
//
//---------------------------------------------------------------------------------------------------------------------

function createScreenshotStage ( sourceCard )
{
    const stage          = document.createElement ( 'div' );
    const exportDocument = document.createElement ( 'div' );
    const clonedCard     = sourceCard.cloneNode ( true );

    clonedCard.hidden = false;
    clonedCard.classList.add ( 'achievement-card--screenshot' );
    clonedCard.querySelector ( '.banner-header__actions' )?.remove ();
    clonedCard.querySelector ( '.achievement-card__footer' )?.remove ();

    replaceSelectControls ( sourceCard, clonedCard );
    replaceCheckboxControls ( sourceCard, clonedCard );
    replaceProgressControls ( sourceCard, clonedCard );
    removeCloneIdentifiers ( clonedCard );

    stage.className          = 'screenshot-stage';
    exportDocument.className = 'screenshot-document';
    exportDocument.append ( clonedCard );
    stage.append ( exportDocument );
    document.body.append ( stage );

    return { card: clonedCard, stage };
}

//---------------------------------------------------------------------------------------------------------------------
// Function: blobToDataUrl
//
// Description:
//
//   Converts an image Blob to an embeddable data URL.
//
// Parameters:
//
// - blob (Blob):
//   The image data to encode.
//
// Returns:
//
//   A Promise resolving to an embeddable data URL.
//
//---------------------------------------------------------------------------------------------------------------------

function blobToDataUrl ( blob )
{
    const reader    = new FileReader ();
    const readTask  = new Promise ( ( resolve, reject ) =>
    {
        reader.addEventListener ( 'load', () => resolve ( String ( reader.result ) ), { once: true } );
        reader.addEventListener ( 'error', () => reject ( reader.error ), { once: true } );
        reader.readAsDataURL ( blob );
    } );

    return waitForBoundedOperation (
        readTask,
        IMAGE_READY_TIMEOUT,
        'A screenshot image could not be prepared in time.',
        () => reader.abort (),
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: waitForImageDecodeRetry
//
// Description:
//
//   Waits briefly before retrying an embedded image decode that Firefox rejected while the data URL was still
//   becoming ready.
//
// Parameters:
//
// - attemptIndex (number):
//   The zero-based failed decode attempt index.
//
// Returns:
//
//   A Promise that settles after the retry delay.
//
//---------------------------------------------------------------------------------------------------------------------

function waitForImageDecodeRetry ( attemptIndex )
{
    return new Promise ( resolve =>
    {
        window.setTimeout ( resolve, IMAGE_DECODE_RETRY_DELAY * ( attemptIndex + 1 ) );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: decodeClonedImage
//
// Description:
//
//   Retries transient data-URL decode failures without re-fetching the already validated image bytes.
//
// Parameters:
//
// - clonedImage (HTMLImageElement):
//   The export-clone image containing an embedded data URL.
//
// Returns:
//
//   A Promise that settles when the browser has decoded the image.
//
//---------------------------------------------------------------------------------------------------------------------

async function decodeClonedImage ( clonedImage )
{
    let lastError = new Error ( 'Image decode failed.' );

    for ( let attemptIndex = 0; attemptIndex < IMAGE_DECODE_ATTEMPTS; attemptIndex += 1 )
    {
        try
        {
            await clonedImage.decode ();

            return;
        }
        catch ( error )
        {
            lastError = error;
        }

        if ( attemptIndex < IMAGE_DECODE_ATTEMPTS - 1 )
        {
            await waitForImageDecodeRetry ( attemptIndex );
        }
    }

    if ( clonedImage.complete && clonedImage.naturalWidth > 0 && clonedImage.naturalHeight > 0 )
    {
        return;
    }

    throw lastError;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: waitForClonedImage
//
// Description:
//
//   Waits until one eager screenshot-clone image has decoded and exposes valid intrinsic dimensions.
//
// Parameters:
//
// - clonedImage (HTMLImageElement):
//   The export-clone image whose data URL must be ready before SVG serialization.
//
// Returns:
//
//   A Promise that settles when the image is safe to rasterize.
//
//---------------------------------------------------------------------------------------------------------------------

async function waitForClonedImage ( clonedImage )
{
    const readinessTask = typeof clonedImage.decode === 'function'
        ? decodeClonedImage ( clonedImage )
        : clonedImage.complete
            ? Promise.resolve ()
            : new Promise ( ( resolve, reject ) =>
            {
                clonedImage.addEventListener ( 'load', resolve, { once: true } );
                clonedImage.addEventListener ( 'error', reject, { once: true } );
            } );

    await waitForBoundedOperation (
        readinessTask,
        IMAGE_READY_TIMEOUT,
        'A screenshot image could not be decoded in time.',
    );

    if ( clonedImage.naturalWidth === 0 || clonedImage.naturalHeight === 0 )
    {
        throw new ScreenshotExportError ( 'A screenshot image could not be decoded.' );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createImageFetchUrl
//
// Description:
//
//   Routes cross-origin Steam images through the allow-listed same-origin image endpoint.
//
// Parameters:
//
// - imageUrl (string):
//   The local or Steam-hosted image location.
//
// Returns:
//
//   A direct same-origin URL or an allow-listed image-proxy URL.
//
//---------------------------------------------------------------------------------------------------------------------

export function createImageFetchUrl ( imageUrl )
{
    const resolvedUrl = new URL ( imageUrl, window.location.href );

    if ( resolvedUrl.origin === window.location.origin )
    {
        return resolvedUrl.href;
    }

    const proxyUrl = new URL ( STEAM_IMAGE_PROXY_PATH, window.location.origin );

    proxyUrl.searchParams.set ( 'url', resolvedUrl.href );

    return proxyUrl.href;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: waitForImageRetry
//
// Description:
//
//   Waits between image-proxy attempts so long screenshot exports do not permanently lose icons to transient Steam CDN
//   failures.
//
// Parameters:
//
// - attemptIndex (number):
//   The zero-based failed attempt index.
//
// Returns:
//
//   A Promise that settles after the retry delay.
//
//---------------------------------------------------------------------------------------------------------------------

function waitForImageRetry ( attemptIndex )
{
    return new Promise ( resolve =>
    {
        window.setTimeout ( resolve, IMAGE_FETCH_RETRY_DELAY * ( attemptIndex + 1 ) );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: fetchScreenshotImage
//
// Description:
//
//   Fetches one embeddable screenshot image with bounded retries for transient image-proxy or Steam CDN failures.
//
// Parameters:
//
// - imageUrl (string):
//   The local or Steam-hosted image location to embed.
//
// Returns:
//
//   A Promise resolving to the successful image Blob.
//
//---------------------------------------------------------------------------------------------------------------------

async function fetchScreenshotImage ( imageUrl )
{
    for ( let attemptIndex = 0; attemptIndex < IMAGE_FETCH_ATTEMPTS; attemptIndex += 1 )
    {
        const requestController = new AbortController ();
        const timeoutId         = window.setTimeout ( () => requestController.abort (), IMAGE_FETCH_TIMEOUT );

        try
        {
            const response = await waitForBoundedOperation (
                fetch (
                    createImageFetchUrl ( imageUrl ),
                    {
                        headers: { accept: 'image/*' },
                        signal:  requestController.signal,
                    },
                ),
                IMAGE_FETCH_TIMEOUT,
                'A screenshot image request timed out.',
                () => requestController.abort (),
            );

            if ( response.ok )
            {
                const imageBlob = await waitForBoundedOperation (
                    response.blob (),
                    IMAGE_FETCH_TIMEOUT,
                    'A screenshot image response timed out.',
                    () => requestController.abort (),
                );

                if ( imageBlob.size > 0 )
                {
                    return imageBlob;
                }
            }
        }
        catch
        {
            // Retry below; the final failure is rendered through the established image fallback.
        }
        finally
        {
            window.clearTimeout ( timeoutId );
        }

        if ( attemptIndex < IMAGE_FETCH_ATTEMPTS - 1 )
        {
            await waitForImageRetry ( attemptIndex );
        }
    }

    throw new Error ( 'Image request failed.' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: applyClonedImageFallback
//
// Description:
//
//   Preserves card geometry with the established fallback when an active image cannot be embedded.
//
// Parameters:
//
// - clonedImage (HTMLImageElement):
//   The export-clone image that could not be embedded.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function applyClonedImageFallback ( clonedImage )
{
    clonedImage.hidden = true;
    clonedImage.removeAttribute ( 'src' );

    if ( clonedImage.classList.contains ( 'achievement-row__icon' ) )
    {
        const placeholder = clonedImage.parentElement?.querySelector ( '.achievement-row__icon-placeholder' );

        if ( placeholder !== null && placeholder !== undefined )
        {
            placeholder.hidden = false;
        }
    }

    if ( clonedImage.classList.contains ( 'control-bar__avatar' ) )
    {
        const placeholder = clonedImage.parentElement?.querySelector ( '.control-bar__avatar-placeholder' );

        if ( placeholder !== null && placeholder !== undefined )
        {
            placeholder.hidden = false;
        }
    }

    if ( clonedImage.classList.contains ( 'banner-header__image' ) )
    {
        const card     = clonedImage.closest ( '.achievement-card' );
        const artwork  = card?.querySelector ( '.banner-header__artwork' );
        const fallback = card?.querySelector ( '.banner-header__fallback' );

        if ( artwork !== null && artwork !== undefined )
        {
            artwork.hidden = true;
        }

        if ( fallback !== null && fallback !== undefined )
        {
            fallback.hidden = false;
        }
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: collectScreenshotImageCandidates
//
// Description:
//
//   Collects the live source followed by any remaining banner fallbacks. Ordinary images retain their single rendered
//   source, while banner candidates come from controller-owned state that is never serialized into the DOM.
//
// Parameters:
//
// - sourceImage (HTMLImageElement):
//   The currently rendered source image.
//
// - clonedImage (HTMLImageElement):
//   The corresponding image in the export clone.
//
// Returns:
//
//   Ordered image candidates safe to pass through the screenshot image boundary.
//
//---------------------------------------------------------------------------------------------------------------------

function collectScreenshotImageCandidates ( sourceImage, clonedImage )
{
    const bannerCandidates = getBannerScreenshotCandidates ( sourceImage ).filter (
        candidate => typeof candidate.url === 'string' && candidate.url.length > 0,
    );

    if ( bannerCandidates.length > 0 )
    {
        return bannerCandidates;
    }

    const sourceUrl = sourceImage.currentSrc
        || sourceImage.getAttribute ( 'src' )
        || clonedImage.getAttribute ( 'src' );

    return sourceUrl === null || sourceUrl.length === 0
        ? []
        : [ { artworkKind: null, url: sourceUrl } ];
}

//---------------------------------------------------------------------------------------------------------------------
// Function: applyClonedBannerCandidate
//
// Description:
//
//   Applies source-specific banner presentation after screenshot capture selects a viable artwork candidate. Only a
//   Library Hero may retain the separate Library Logo overlay.
//
// Parameters:
//
// - clonedImage (HTMLImageElement):
//   The export-clone image receiving the selected candidate.
//
// - imageCandidate (object):
//   The selected candidate and its artwork presentation kind.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function applyClonedBannerCandidate ( clonedImage, imageCandidate )
{
    if ( !clonedImage.classList.contains ( 'banner-header__image' ) )
    {
        return;
    }

    const card     = clonedImage.closest ( '.achievement-card' );
    const artwork  = card?.querySelector ( '.banner-header__artwork' );
    const fallback = card?.querySelector ( '.banner-header__fallback' );

    if ( artwork !== null && artwork !== undefined && imageCandidate.artworkKind !== null )
    {
        artwork.hidden = false;
        artwork.setAttribute ( 'data-artwork-kind', imageCandidate.artworkKind );
    }

    if ( fallback !== null && fallback !== undefined )
    {
        fallback.hidden = true;
    }

    if ( imageCandidate.artworkKind === 'fallback' )
    {
        const gameLogo = card?.querySelector ( '.banner-header__game-logo' );

        if ( gameLogo !== null && gameLogo !== undefined )
        {
            gameLogo.hidden = true;
            gameLogo.removeAttribute ( 'src' );
            gameLogo.removeAttribute ( 'srcset' );
        }
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: inlineClonedImage
//
// Description:
//
//   Embeds one currently rendered source image in its corresponding screenshot clone image.
//
// Parameters:
//
// - sourceImage (HTMLImageElement):
//   The currently rendered source image.
//
// - clonedImage (HTMLImageElement):
//   The corresponding image in the export clone.
//
// Returns:
//
//   A Promise that settles after the image or its fallback is embedded.
//
//---------------------------------------------------------------------------------------------------------------------

export async function inlineClonedImage ( sourceImage, clonedImage )
{
    if ( clonedImage === undefined )
    {
        return;
    }

    const hiddenAncestor  = sourceImage.closest ( '[hidden]' );
    const imageCandidates = collectScreenshotImageCandidates ( sourceImage, clonedImage );

    clonedImage.removeAttribute ( 'loading' );
    clonedImage.decoding = 'sync';

    if ( sourceImage.hidden || hiddenAncestor !== null || imageCandidates.length === 0 )
    {
        clonedImage.removeAttribute ( 'src' );
        clonedImage.removeAttribute ( 'srcset' );

        return;
    }

    clonedImage.removeAttribute ( 'srcset' );

    for ( const imageCandidate of imageCandidates )
    {
        try
        {
            const imageBlob    = await fetchScreenshotImage ( imageCandidate.url );
            const imageDataUrl = await blobToDataUrl ( imageBlob );

            clonedImage.src = imageDataUrl;

            await waitForClonedImage ( clonedImage );
            applyClonedBannerCandidate ( clonedImage, imageCandidate );

            return;
        }
        catch
        {
            // Continue through the controller's ordered fallback chain before changing the established presentation.
        }
    }

    applyClonedImageFallback ( clonedImage );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: inlineScreenshotImages
//
// Description:
//
//   Embeds rendered card images in bounded parallel batches before rasterization.
//
// Parameters:
//
// - sourceCard (HTMLElement):
//   The active achievement card containing source images.
//
// - clonedCard (HTMLElement):
//   The detached export clone receiving embedded images.
//
// - reportProgress (Function):
//   The optional application callback receiving screenshot stage reports.
//
// Returns:
//
//   A Promise that settles after all visible images are processed.
//
//---------------------------------------------------------------------------------------------------------------------

async function inlineScreenshotImages ( sourceCard, clonedCard, reportProgress )
{
    const sourceImages = [ ...sourceCard.querySelectorAll ( 'img' ) ];
    const clonedImages = [ ...clonedCard.querySelectorAll ( 'img' ) ];
    const startTime    = Date.now ();

    reportScreenshotProgress (
        reportProgress,
        2,
        sourceImages.length === 0
            ? 'Preparing screenshot images…'
            : `Preparing screenshot images (0 of ${sourceImages.length})…`,
    );

    for ( let imageIndex = 0; imageIndex < sourceImages.length; imageIndex += IMAGE_INLINE_CONCURRENCY )
    {
        if ( Date.now () - startTime >= IMAGE_INLINE_TIMEOUT )
        {
            // Preserve a bounded export by applying established fallbacks to every image not yet processed.

            for ( let remainingIndex = imageIndex; remainingIndex < sourceImages.length; remainingIndex += 1 )
            {
                const sourceImage = sourceImages [ remainingIndex ];
                const clonedImage = clonedImages [ remainingIndex ];

                if ( clonedImage === undefined )
                {
                    continue;
                }

                clonedImage.removeAttribute ( 'loading' );
                clonedImage.decoding = 'sync';

                if ( sourceImage.hidden || sourceImage.closest ( '[hidden]' ) !== null )
                {
                    clonedImage.removeAttribute ( 'src' );
                    clonedImage.removeAttribute ( 'srcset' );

                    continue;
                }

                applyClonedImageFallback ( clonedImage );
            }

            reportScreenshotProgress (
                reportProgress,
                2,
                'Prepared available screenshot images; unavailable images use their visual fallbacks.',
                true,
            );

            return;
        }

        const batch = sourceImages.slice ( imageIndex, imageIndex + IMAGE_INLINE_CONCURRENCY ).map (
            ( sourceImage, batchIndex ) => inlineClonedImage (
                sourceImage,
                clonedImages [ imageIndex + batchIndex ],
            ),
        );

        await Promise.all ( batch );

        const completedImageCount = Math.min ( sourceImages.length, imageIndex + batch.length );

        reportScreenshotProgress (
            reportProgress,
            2,
            `Preparing screenshot images (${completedImageCount} of ${sourceImages.length})…`,
            completedImageCount === sourceImages.length,
        );
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: collectStylesheetText
//
// Description:
//
//   Collects the application's same-origin CSS rules for each self-contained SVG tile.
// Returns:
//
//   The concatenated same-origin stylesheet rules.
//
//---------------------------------------------------------------------------------------------------------------------

function collectStylesheetText ()
{
    return [ ...document.styleSheets ].map ( styleSheet =>
    {
        try
        {
            return [ ...styleSheet.cssRules ].map ( rule => rule.cssText ).join ( '\n' );
        }
        catch
        {
            return '';
        }
    } ).join ( '\n' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSvgTileCardClone
//
// Description:
//
//   Clones the prepared card for foreign-object rendering while retaining achievement-icon layout boxes without
//   asking Firefox to decode the same embedded icon again inside the SVG image.
//
// Parameters:
//
// - card (HTMLElement):
//   The prepared export card.
//
// Returns:
//
//   The cloned card used inside one SVG tile.
//
//---------------------------------------------------------------------------------------------------------------------

function createSvgTileCardClone ( card )
{
    const clonedCard = card.cloneNode ( true );

    clonedCard.querySelectorAll ( ACHIEVEMENT_ICON_SELECTOR ).forEach ( achievementIcon =>
    {
        achievementIcon.style.visibility = 'hidden';
        achievementIcon.removeAttribute ( 'src' );
        achievementIcon.removeAttribute ( 'srcset' );
    } );

    return clonedCard;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSvgTileDataUrl
//
// Description:
//
//   Serializes one translated view of the complete screenshot clone into a self-contained SVG tile.
//
// Parameters:
//
// - card (HTMLElement):
//   The prepared export card.
//
// - stylesheetText (string):
//   The CSS rules needed to render the card.
//
// - verticalOffset (number):
//   The upper pixel offset of this tile.
//
// - tileHeight (number):
//   The height of this tile in pixels.
//
// - totalHeight (number):
//   The complete export height in pixels.
//
// Returns:
//
//   A self-contained SVG tile data URL.
//
//---------------------------------------------------------------------------------------------------------------------

function createSvgTileDataUrl ( card, stylesheetText, verticalOffset, tileHeight, totalHeight )
{
    const svg            = document.createElementNS ( SVG_NAMESPACE, 'svg' );
    const style          = document.createElementNS ( SVG_NAMESPACE, 'style' );
    const foreignObject  = document.createElementNS ( SVG_NAMESPACE, 'foreignObject' );
    const exportDocument = document.createElementNS ( XML_NAMESPACE, 'div' );

    svg.setAttribute ( 'xmlns', SVG_NAMESPACE );
    svg.setAttribute ( 'width', String ( SCREENSHOT_WIDTH ) );
    svg.setAttribute ( 'height', String ( tileHeight ) );
    svg.setAttribute ( 'viewBox', `0 0 ${SCREENSHOT_WIDTH} ${tileHeight}` );
    style.textContent = stylesheetText;

    foreignObject.setAttribute ( 'x', '0' );
    foreignObject.setAttribute ( 'y', String ( -verticalOffset ) );
    foreignObject.setAttribute ( 'width', String ( SCREENSHOT_WIDTH ) );
    foreignObject.setAttribute ( 'height', String ( totalHeight ) );

    exportDocument.setAttribute ( 'class', 'screenshot-document' );
    exportDocument.append ( createSvgTileCardClone ( card ) );
    foreignObject.append ( exportDocument );
    svg.append ( style, foreignObject );

    const serializedSvg = new XMLSerializer ().serializeToString ( svg );

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent ( serializedSvg )}`;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: drawAchievementIconsOnTile
//
// Description:
//
//   Draws already decoded achievement icons directly onto one canvas tile. Firefox can otherwise omit nested data-URL
//   images while rasterizing an SVG foreign object even after those images decoded successfully in the source card.
//
// Parameters:
//
// - card (HTMLElement):
//   The prepared export card containing decoded achievement icons.
//
// - context (CanvasRenderingContext2D):
//   The tile canvas context receiving the icons.
//
// - verticalOffset (number):
//   The upper card offset represented by this tile.
//
// - tileHeight (number):
//   The height of this tile in pixels.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function drawAchievementIconsOnTile ( card, context, verticalOffset, tileHeight )
{
    const cardRectangle = card.getBoundingClientRect ();

    card.querySelectorAll ( ACHIEVEMENT_ICON_SELECTOR ).forEach ( achievementIcon =>
    {
        if (
            achievementIcon.hidden
            || achievementIcon.closest ( '[hidden]' ) !== null
            || !achievementIcon.complete
            || achievementIcon.naturalWidth === 0
            || achievementIcon.naturalHeight === 0
        )
        {
            return;
        }

        const imageRectangle = achievementIcon.getBoundingClientRect ();
        const destinationX   = imageRectangle.left - cardRectangle.left;
        const destinationY   = imageRectangle.top - cardRectangle.top - verticalOffset;

        if (
            destinationX + imageRectangle.width <= 0
            || destinationX >= SCREENSHOT_WIDTH
            || destinationY + imageRectangle.height <= 0
            || destinationY >= tileHeight
        )
        {
            return;
        }

        const imageStyle = window.getComputedStyle ( achievementIcon );
        const opacity    = Number.parseFloat ( imageStyle.opacity );

        context.save ();

        if ( Number.isFinite ( opacity ) )
        {
            context.globalAlpha = opacity;
        }

        if ( typeof imageStyle.filter === 'string' && imageStyle.filter.length > 0 )
        {
            context.filter = imageStyle.filter;
        }

        context.drawImage (
            achievementIcon,
            destinationX,
            destinationY,
            imageRectangle.width,
            imageRectangle.height,
        );
        context.restore ();
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: rasterizeScreenshotTile
//
// Description:
//
//   Rasterizes one translated SVG view into a bounded-height canvas.
//
// Parameters:
//
// - card (HTMLElement):
//   The prepared export card.
//
// - stylesheetText (string):
//   The CSS rules needed to render the card.
//
// - verticalOffset (number):
//   The upper pixel offset of this tile.
//
// - tileHeight (number):
//   The height of this tile in pixels.
//
// - totalHeight (number):
//   The complete export height in pixels.
//
// - reportProgress (Function):
//   The optional application callback receiving screenshot stage reports.
//
// Returns:
//
//   A Promise resolving to the rasterized tile canvas.
//
//---------------------------------------------------------------------------------------------------------------------

async function rasterizeScreenshotTile ( card, stylesheetText, verticalOffset, tileHeight, totalHeight )
{
    const canvas     = document.createElement ( 'canvas' );
    const context    = canvas.getContext ( '2d', { willReadFrequently: true } );
    const image      = new Image ();
    const svgDataUrl = createSvgTileDataUrl ( card, stylesheetText, verticalOffset, tileHeight, totalHeight );

    if ( context === null )
    {
        throw new ScreenshotExportError ( 'This browser could not create the screenshot canvas.' );
    }

    canvas.width  = SCREENSHOT_WIDTH;
    canvas.height = tileHeight;

    try
    {
        image.src = svgDataUrl;

        await waitForBoundedOperation (
            image.decode (),
            RENDER_TILE_TIMEOUT,
            'This browser could not render the screenshot in time.',
            () =>
            {
                image.src = '';
            },
        );

        if ( image.naturalWidth === 0 || image.naturalHeight === 0 )
        {
            throw new ScreenshotExportError ( 'This browser could not render the screenshot.' );
        }

        context.drawImage ( image, 0, 0 );
        drawAchievementIconsOnTile ( card, context, verticalOffset, tileHeight );

        return canvas;
    }
    finally
    {
        image.src = '';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createFilteredScanlines
//
// Description:
//
//   Prefixes each RGBA canvas row with PNG filter type zero for streaming compression.
//
// Parameters:
//
// - canvas (HTMLCanvasElement):
//   The rendered RGBA tile canvas.
//
// Returns:
//
//   PNG filter-prefixed scanline bytes for the tile.
//
//---------------------------------------------------------------------------------------------------------------------

function createFilteredScanlines ( canvas )
{
    const context       = canvas.getContext ( '2d', { willReadFrequently: true } );
    const bytesPerRow   = ( canvas.width * 4 ) + 1;
    const filteredBytes = new Uint8Array ( bytesPerRow * canvas.height );

    if ( context === null )
    {
        throw new ScreenshotExportError ( 'This browser could not read the screenshot canvas.' );
    }

    const pixels = context.getImageData ( 0, 0, canvas.width, canvas.height ).data;

    for ( let rowIndex = 0; rowIndex < canvas.height; rowIndex += 1 )
    {
        const destinationOffset = rowIndex * bytesPerRow;
        const sourceOffset      = rowIndex * canvas.width * 4;

        filteredBytes [ destinationOffset ] = 0;
        filteredBytes.set (
            pixels.subarray ( sourceOffset, sourceOffset + ( canvas.width * 4 ) ),
            destinationOffset + 1,
        );
    }

    return filteredBytes;
}
//---------------------------------------------------------------------------------------------------------------------
// Function: renderContinuousPng
//
// Description:
//
//   Streams bounded raster tiles into one PNG without allocating a final tall canvas.
//
// Parameters:
//
// - card (HTMLElement):
//   The prepared export card.
//
// - stylesheetText (string):
//   The CSS rules needed to render the card.
//
// - totalHeight (number):
//   The complete export height in pixels.
//
// Returns:
//
//   A Promise resolving to one continuous PNG Blob.
//
//---------------------------------------------------------------------------------------------------------------------

async function renderContinuousPng ( card, stylesheetText, totalHeight, reportProgress )
{
    if ( typeof CompressionStream !== 'function' )
    {
        throw new ScreenshotExportError ( 'Continuous PNG encoding is unavailable in this browser.' );
    }

    const compressionStream  = new CompressionStream ( 'deflate' );
    const compressedDataTask = new Response ( compressionStream.readable ).arrayBuffer ();
    const compressionWriter  = compressionStream.writable.getWriter ();
    const tileCount          = Math.ceil ( totalHeight / RENDER_TILE_HEIGHT );
    let tileNumber           = 0;

    try
    {
        for ( let verticalOffset = 0; verticalOffset < totalHeight; verticalOffset += RENDER_TILE_HEIGHT )
        {
            tileNumber += 1;

            reportScreenshotProgress (
                reportProgress,
                3,
                `Rendering screenshot tile ${tileNumber} of ${tileCount}…`,
            );

            const tileHeight = Math.min ( RENDER_TILE_HEIGHT, totalHeight - verticalOffset );
            const canvas     = await rasterizeScreenshotTile (
                card,
                stylesheetText,
                verticalOffset,
                tileHeight,
                totalHeight,
            );

            await waitForBoundedOperation (
                compressionWriter.write ( createFilteredScanlines ( canvas ) ),
                ENCODER_OPERATION_TIMEOUT,
                'The screenshot encoder did not accept image data in time.',
            );
            canvas.width  = 1;
            canvas.height = 1;
        }

        reportScreenshotProgress ( reportProgress, 3, 'Encoding screenshot PNG…' );

        await waitForBoundedOperation (
            compressionWriter.close (),
            ENCODER_OPERATION_TIMEOUT,
            'The screenshot encoder did not finish in time.',
        );
    }
    catch ( error )
    {
        await waitForBoundedOperation (
            compressionWriter.abort ( error ),
            CLEANUP_OPERATION_TIMEOUT,
            'The screenshot encoder cleanup timed out.',
        ).catch ( () => undefined );
        await waitForBoundedOperation (
            compressedDataTask,
            CLEANUP_OPERATION_TIMEOUT,
            'The screenshot encoder cleanup timed out.',
        ).catch ( () => undefined );

        throw error;
    }
    finally
    {
        compressionWriter.releaseLock ();
    }

    const compressedData = await waitForBoundedOperation (
        compressedDataTask,
        ENCODER_OPERATION_TIMEOUT,
        'The screenshot encoder did not return image data in time.',
    );

    return assemblePng ( SCREENSHOT_WIDTH, totalHeight, new Uint8Array ( compressedData ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: canvasToPngBlob
//
// Description:
//
//   Encodes one bounded fallback canvas as PNG.
//
// Parameters:
//
// - canvas (HTMLCanvasElement):
//   The bounded fallback canvas to encode.
//
// Returns:
//
//   A Promise resolving to the encoded PNG Blob.
//
//---------------------------------------------------------------------------------------------------------------------

function canvasToPngBlob ( canvas )
{
    const encodingTask = new Promise ( ( resolve, reject ) =>
    {
        canvas.toBlob ( blob =>
        {
            if ( blob === null )
            {
                reject ( new ScreenshotExportError ( 'This browser could not encode the screenshot as PNG.' ) );

                return;
            }

            resolve ( blob );
        }, PNG_MIME_TYPE );
    } );

    return waitForBoundedOperation (
        encodingTask,
        ENCODER_OPERATION_TIMEOUT,
        'This browser could not encode the screenshot in time.',
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: measureFallbackPartitions
//
// Description:
//
//   Measures row-safe groups after reserving space for the repeated banner, progress, and control bar.
//
// Parameters:
//
// - card (HTMLElement):
//   The prepared export card whose rows are measured.
//
// Returns:
//
//   Ordered row-safe fallback partitions.
//
//---------------------------------------------------------------------------------------------------------------------

function measureFallbackPartitions ( card )
{
    const list = card.querySelector ( ACHIEVEMENT_LIST_SELECTOR );

    if ( list === null )
    {
        return [ { end: 0, start: 0 } ];
    }

    const rows            = [ ...list.children ];
    const listStyle       = getComputedStyle ( list );
    const rowGap          = Number.parseFloat ( listStyle.rowGap ) || 0;
    const rowHeights      = rows.map ( row => row.getBoundingClientRect ().height );
    const rowArea         = rowHeights.reduce ( ( total, height ) => total + height, 0 )
        + ( Math.max ( 0, rowHeights.length - 1 ) * rowGap );
    const fixedHeight     = Math.max ( 0, card.scrollHeight - rowArea );
    const availableHeight = Math.max (
        Math.max ( ...rowHeights, 1 ),
        FALLBACK_IMAGE_HEIGHT - fixedHeight,
    );

    return partitionRowsByHeight ( rowHeights, availableHeight, rowGap );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createFallbackPartCard
//
// Description:
//
//   Creates one card containing only a complete partition of achievement rows.
//
// Parameters:
//
// - card (HTMLElement):
//   The complete prepared export card.
//
// - partition (object):
//   The start and end row indices retained in this part.
//
// Returns:
//
//   A cloned card containing one complete row partition.
//
//---------------------------------------------------------------------------------------------------------------------

function createFallbackPartCard ( card, partition )
{
    const partCard = card.cloneNode ( true );
    const partList = partCard.querySelector ( ACHIEVEMENT_LIST_SELECTOR );

    if ( partList !== null )
    {
        [ ...partList.children ].forEach ( ( row, rowIndex ) =>
        {
            if ( rowIndex < partition.start || rowIndex >= partition.end )
            {
                row.remove ();
            }
        } );
    }

    return partCard;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: attachPartStage
//
// Description:
//
//   Attaches one fallback card for accurate height measurement.
//
// Parameters:
//
// - partCard (HTMLElement):
//   The bounded fallback card to attach.
//
// Returns:
//
//   The detached stage containing the fallback card.
//
//---------------------------------------------------------------------------------------------------------------------

function attachPartStage ( partCard )
{
    const stage          = document.createElement ( 'div' );
    const exportDocument = document.createElement ( 'div' );

    stage.className          = 'screenshot-stage';
    exportDocument.className = 'screenshot-document';
    exportDocument.append ( partCard );
    stage.append ( exportDocument );
    document.body.append ( stage );

    return stage;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: prepareFallbackPartAchievementIcons
//
// Description:
//
//   Decodes the data-URL icon copies created for one numbered fallback part before direct canvas compositing. All
//   icons settle concurrently so one stalled Firefox decode cannot extend the fallback by one timeout per row.
//
// Parameters:
//
// - partCard (HTMLElement):
//   The attached numbered-fallback card containing cloned achievement icons.
//
// Returns:
//
//   A Promise that settles after each icon is ready or has adopted its neutral fallback.
//
//---------------------------------------------------------------------------------------------------------------------

async function prepareFallbackPartAchievementIcons ( partCard )
{
    const achievementIcons = [ ...partCard.querySelectorAll ( ACHIEVEMENT_ICON_SELECTOR ) ];

    await Promise.all ( achievementIcons.map ( async achievementIcon =>
    {
        achievementIcon.removeAttribute ( 'loading' );
        achievementIcon.decoding = 'sync';

        if (
            achievementIcon.hidden
            || achievementIcon.closest ( '[hidden]' ) !== null
            || achievementIcon.getAttribute ( 'src' ) === null
        )
        {
            return;
        }

        try
        {
            await waitForClonedImage ( achievementIcon );
        }
        catch
        {
            applyClonedImageFallback ( achievementIcon );
        }
    } ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: renderNumberedFallbackPngs
//
// Description:
//
//   Renders bounded-height PNG parts with the identifying card header repeated on every image.
//
// Parameters:
//
// - card (HTMLElement):
//   The prepared complete export card.
//
// - stylesheetText (string):
//   The CSS rules needed to render each part.
//
// - reportProgress (Function):
//   The optional application callback receiving screenshot stage reports.
//
// Returns:
//
//   A Promise resolving to ordered row-safe PNG Blobs.
//
//---------------------------------------------------------------------------------------------------------------------

async function renderNumberedFallbackPngs ( card, stylesheetText, reportProgress )
{
    const partitions = measureFallbackPartitions ( card );
    const pngBlobs    = [];

    for ( let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex += 1 )
    {
        const partition = partitions [ partitionIndex ];

        reportScreenshotProgress (
            reportProgress,
            3,
            `Rendering numbered screenshot file ${partitionIndex + 1} of ${partitions.length}…`,
        );

        const partCard  = createFallbackPartCard ( card, partition );
        const partStage = attachPartStage ( partCard );

        try
        {
            await prepareFallbackPartAchievementIcons ( partCard );

            const partHeight = Math.ceil ( partCard.scrollHeight );
            const canvas     = await rasterizeScreenshotTile (
                partCard,
                stylesheetText,
                0,
                partHeight,
                partHeight,
            );

            pngBlobs.push ( await canvasToPngBlob ( canvas ) );
        }
        finally
        {
            partStage.remove ();
        }
    }

    return pngBlobs;
}
//---------------------------------------------------------------------------------------------------------------------
// Function: beginSaveFilePicker
//
// Description:
//
//   Opens the native Save As picker during the initiating user gesture when supported.
//
// Parameters:
//
// - fileName (string):
//   The suggested PNG filename.
//
// Returns:
//
//   The native file-handle Promise, or null when the picker is unavailable.
//
//---------------------------------------------------------------------------------------------------------------------

function beginSaveFilePicker ( fileName )
{
    if ( typeof window.showSaveFilePicker !== 'function' )
    {
        return null;
    }

    return window.showSaveFilePicker (
        {
            suggestedName: fileName,
            types:
            [
                {
                    accept: { [ PNG_MIME_TYPE ]: [ '.png' ] },
                    description: 'PNG image',
                },
            ],
        },
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: abortWritableFile
//
// Description:
//
//   Performs bounded best-effort cancellation after a native file write or close failure.
//
// Parameters:
//
// - writableFile (FileSystemWritableFileStream):
//   The native writable stream requiring cleanup.
//
// Returns:
//
//   A Promise that always settles after the cleanup attempt or its short timeout.
//
//---------------------------------------------------------------------------------------------------------------------

async function abortWritableFile ( writableFile )
{
    if ( typeof writableFile.abort !== 'function' )
    {
        return;
    }

    await waitForBoundedOperation (
        writableFile.abort (),
        CLEANUP_OPERATION_TIMEOUT,
        'The screenshot file cleanup timed out.',
    ).catch ( () => undefined );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: writeFileHandle
//
// Description:
//
//   Opens a native writable only after validated PNG bytes exist, then performs bounded write and close operations.
//
// Parameters:
//
// - fileHandle (FileSystemFileHandle):
//   The file selected through the native picker.
//
// - pngBytes (Uint8Array):
//   The PNG data to write.
//
// Returns:
//
//   A Promise that settles after the file is closed.
//
//---------------------------------------------------------------------------------------------------------------------

async function writeFileHandle ( fileHandle, pngBytes )
{
    const writableFileRequest = fileHandle.createWritable ();
    const writableFile = await waitForBoundedOperation (
        writableFileRequest,
        SAVE_OPERATION_TIMEOUT,
        'The screenshot file could not be opened in time.',
        () =>
        {
            Promise.resolve ( writableFileRequest ).then (
                lateWritableFile => abortWritableFile ( lateWritableFile ),
                () => undefined,
            );
        },
    );

    try
    {
        await waitForBoundedOperation (
            writableFile.write ( pngBytes ),
            SAVE_OPERATION_TIMEOUT,
            'The screenshot file could not be written in time.',
        );
        await waitForBoundedOperation (
            writableFile.close (),
            SAVE_OPERATION_TIMEOUT,
            'The screenshot file could not be closed in time.',
        );
    }
    catch ( error )
    {
        await abortWritableFile ( writableFile );

        throw error;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: downloadPreparedScreenshotFile
//
// Description:
//
//   Starts one prepared browser download through a temporary Blob URL and anchor.
//
// Parameters:
//
// - preparedFile (object):
//   The validated PNG Blob and browser download filename.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function downloadPreparedScreenshotFile ( preparedFile )
{
    const anchor  = document.createElement ( 'a' );
    const blobUrl = URL.createObjectURL ( preparedFile.blob );

    anchor.download = preparedFile.fileName;
    anchor.href     = blobUrl;
    document.body.append ( anchor );
    anchor.click ();
    anchor.remove ();
    window.setTimeout ( () => URL.revokeObjectURL ( blobUrl ), DOWNLOAD_URL_LIFETIME );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: saveScreenshotFiles
//
// Description:
//
//   Saves one PNG through the chosen handle, or returns validated files for browser-download handling.
//
// Parameters:
//
// - pngBlobs (Blob[]):
//   The continuous image or ordered emergency fallback images.
//
// - fileName (string):
//   The base PNG filename.
//
// - fileHandle (FileSystemFileHandle or null):
//   The native destination selected by the user, when available.
//
// - reportProgress (Function):
//   The optional application callback receiving screenshot stage reports.
//
// Returns:
//
//   A Promise resolving to the save result or prepared fallback downloads.
//
//---------------------------------------------------------------------------------------------------------------------

async function saveScreenshotFiles ( pngBlobs, fileName, fileHandle, reportProgress )
{
    const pngBytesCollection = [];

    reportScreenshotProgress ( reportProgress, 4, 'Validating screenshot PNG…' );

    for ( let pngIndex = 0; pngIndex < pngBlobs.length; pngIndex += 1 )
    {
        const pngBlob = pngBlobs [ pngIndex ];

        pngBytesCollection.push ( await readPngBlobBytes ( pngBlob ) );

        reportScreenshotProgress (
            reportProgress,
            4,
            pngBlobs.length === 1
                ? 'Validated screenshot PNG.'
                : `Validated screenshot PNG ${pngIndex + 1} of ${pngBlobs.length}.`,
            pngIndex === pngBlobs.length - 1,
        );
    }

    if ( pngBlobs.length === 1 && fileHandle !== null )
    {
        reportScreenshotProgress ( reportProgress, 5, 'Saving screenshot…' );
        await writeFileHandle ( fileHandle, pngBytesCollection [ 0 ] );
        reportScreenshotProgress ( reportProgress, 5, 'Screenshot saved.', true );

        return (
            {
                fileCount:              1,
                kind:                   'saved',
                nativeDestinationUnused: false,
            }
        );
    }

    const files = pngBlobs.map ( ( pngBlob, partIndex ) =>
    {
        const preparedFileName = pngBlobs.length === 1
            ? fileName
            : createNumberedScreenshotFileName ( fileName, partIndex + 1, pngBlobs.length );

        return (
            {
                blob:     pngBlob,
                fileName: preparedFileName,
            }
        );
    } );

    reportScreenshotProgress (
        reportProgress,
        5,
        fileHandle !== null
            ? 'Numbered screenshot downloads are ready.'
            : 'Screenshot is ready to download.',
        true,
    );

    return (
        {
            fileCount:              files.length,
            files,
            kind:                   'download-ready',
            nativeDestinationUnused: fileHandle !== null,
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: captureAchievementScreenshot
//
// Description:
//
//   Captures the active card and saves one stitched PNG, using row-safe numbered files only as an emergency fallback.
//
// Parameters:
//
// - sourceCard (HTMLElement):
//   The active achievement card to export.
//
// - gameName (string):
//   The selected game name used for the filename.
//
// - reportStatus (Function):
//   The callback used to announce terminal export status.
//
// - reportProgress (Function):
//   The optional application callback receiving structured generation stages.
//
// Returns:
//
//   A native-save, download-ready, or cancelled result.
//
//---------------------------------------------------------------------------------------------------------------------

export async function captureAchievementScreenshot (
    sourceCard,
    gameName,
    reportStatus = () => undefined,
    reportProgress = () => undefined,
)
{
    const fileName          = createScreenshotFileName ( gameName );
    const fileHandleRequest = beginSaveFilePicker ( fileName );
    let fileHandle          = null;
    let stageData           = null;

    try
    {
        if ( fileHandleRequest !== null )
        {
            try
            {
                fileHandle = await fileHandleRequest;
            }
            catch ( error )
            {
                if ( error instanceof DOMException && error.name === 'AbortError' )
                {
                    reportStatus ( 'Screenshot export cancelled.' );

                    return (
                        {
                            fileCount: 0,
                            kind:      'cancelled',
                        }
                    );
                }

                throw error;
            }
        }

        reportScreenshotProgress ( reportProgress, 1, 'Preparing screenshot layout…' );
        await waitForScreenshotFeedbackPaint ();

        stageData = createScreenshotStage ( sourceCard );

        await inlineScreenshotImages ( sourceCard, stageData.card, reportProgress );

        const stylesheetText = collectStylesheetText ();
        const totalHeight    = Math.ceil ( stageData.card.scrollHeight );

        if ( totalHeight <= 0 || totalHeight > SCREENSHOT_HEIGHT_LIMIT )
        {
            throw new ScreenshotExportError ( 'The screenshot dimensions are not supported.' );
        }

        let pngBlobs;

        try
        {
            pngBlobs = [ await renderContinuousPng ( stageData.card, stylesheetText, totalHeight, reportProgress ) ];
        }
        catch
        {
            reportStatus ( 'The single image was too large; preparing numbered PNG files…' );
            reportScreenshotProgress ( reportProgress, 3, 'Preparing numbered screenshot files…' );
            pngBlobs = await renderNumberedFallbackPngs ( stageData.card, stylesheetText, reportProgress );
        }

        const saveResult = await saveScreenshotFiles ( pngBlobs, fileName, fileHandle, reportProgress );

        if ( saveResult.kind === 'saved' )
        {
            reportStatus ( `Saved ${fileName}.` );
        }

        return saveResult;
    }
    catch ( error )
    {
        if ( error instanceof ScreenshotExportError )
        {
            throw error;
        }

        const screenshotError = new ScreenshotExportError ( 'The achievement screenshot could not be created.' );

        screenshotError.cause = error;

        throw screenshotError;
    }
    finally
    {
        stageData?.stage.remove ();
    }
}
