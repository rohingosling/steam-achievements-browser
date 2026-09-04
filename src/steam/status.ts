//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-29
// Author:  Rohin Gosling
//
// Description:
//
//   Minimal authenticated Steam connectivity probe used to validate local and deployed Worker secret configuration.
//   The normalized result deliberately excludes Steam's response body and the authenticated request URL.
//
// TODO:
//
//   1. Remove the diagnostic route after production deployment acceptance if ongoing health probing is unnecessary.
//
//---------------------------------------------------------------------------------------------------------------------

import { isJsonObject, requestSteamJson } from './client';

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

interface SupportedApiListResponse
{
    apilist:
    {
        interfaces: unknown [];
    };
}

//---------------------------------------------------------------------------------------------------------------------
// Validation.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isSupportedApiListResponse
//
// Description:
//
//   Determines whether the supplied value satisfies the supported API list response contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the supported API list response contract.
//
//---------------------------------------------------------------------------------------------------------------------

function isSupportedApiListResponse ( value: unknown ): value is SupportedApiListResponse
{
    if ( !isJsonObject ( value ) || !isJsonObject ( value.apilist ) )
    {
        return false;
    }

    return Array.isArray ( value.apilist.interfaces );
}

//---------------------------------------------------------------------------------------------------------------------
// Probe.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: probeSteamApi
//
// Description:
//
//   Probes steam API without exposing sensitive upstream details.
//
// Parameters:
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export async function probeSteamApi ( apiKey: string | undefined, fetchFunction: typeof fetch = fetch ): Promise<void>
{
    await requestSteamJson (
        {
            interfaceName: 'ISteamWebAPIUtil',
            methodName:    'GetSupportedAPIList',
            parameters:
            {
                format: 'json',
            },
            validate:      isSupportedApiListResponse,
            version:       1,
        },
        {
            apiKey,
            fetchFunction,
        },
    );
}
