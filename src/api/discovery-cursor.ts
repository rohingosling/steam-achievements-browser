//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Opaque progressive-discovery cursor encoding. The token contains only a versioned offset into a deterministic
//   library ordering, so it carries no user library data and requires structural validation rather than signing.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const CURSOR_VERSION = 1;
const BAD_REQUEST    = 400;

//---------------------------------------------------------------------------------------------------------------------
// Normalized errors.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: GameDiscoveryCursorError
//
// Description:
//
//   Represents a normalized game discovery cursor failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class GameDiscoveryCursorError extends Error
{
    public readonly code   = 'GAME_DISCOVERY_CURSOR_INVALID';
    public readonly status = BAD_REQUEST;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a GameDiscoveryCursorError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super ( 'The game-discovery cursor is invalid.' );

        this.name = 'GameDiscoveryCursorError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Cursor encoding and validation.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isCursorValue
//
// Description:
//
//   Determines whether the supplied value satisfies the cursor value contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the cursor value contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isCursorValue ( value: unknown ): value is { offset: number; version: number }
{
    if ( typeof value !== 'object' || value === null || Array.isArray ( value ) )
    {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return Object.keys ( candidate ).length === 2
        && candidate.version === CURSOR_VERSION
        && Number.isSafeInteger ( candidate.offset )
        && ( candidate.offset as number ) >= 0;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: encodeDiscoveryCursor
//
// Description:
//
//   Encodes discovery cursor into its transport representation.
//
// Parameters:
//
// - offset (number):
//   The zero-based discovery position encoded by the cursor.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function encodeDiscoveryCursor ( offset: number ): string
{
    if ( !Number.isSafeInteger ( offset ) || offset < 0 )
    {
        throw new GameDiscoveryCursorError ();
    }

    const serializedCursor = JSON.stringify ( { offset, version: CURSOR_VERSION } );

    return btoa ( serializedCursor )
        .replaceAll ( '+', '-' )
        .replaceAll ( '/', '_' )
        .replace ( /=+$/, '' );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: decodeDiscoveryCursor
//
// Description:
//
//   Decodes and validates discovery cursor.
//
// Parameters:
//
// - cursor (string):
//   The opaque continuation cursor supplied by the previous discovery response.
//
// Returns:
//
//   The resulting number value.
//
//---------------------------------------------------------------------------------------------------------------------

export function decodeDiscoveryCursor ( cursor: string ): number
{
    if ( !/^[A-Za-z0-9_-]+$/.test ( cursor ) )
    {
        throw new GameDiscoveryCursorError ();
    }

    try
    {
        const base64Cursor    = cursor.replaceAll ( '-', '+' ).replaceAll ( '_', '/' );
        const padding         = '='.repeat ( ( 4 - base64Cursor.length % 4 ) % 4 );
        const serializedValue = atob ( `${base64Cursor}${padding}` );
        const value           = JSON.parse ( serializedValue ) as unknown;

        if ( !isCursorValue ( value ) )
        {
            throw new GameDiscoveryCursorError ();
        }

        return value.offset;
    }
    catch ( error )
    {
        if ( error instanceof GameDiscoveryCursorError )
        {
            throw error;
        }

        throw new GameDiscoveryCursorError ();
    }
}
