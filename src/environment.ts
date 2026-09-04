//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Cloudflare Worker binding types shared by the Worker entry point and backend modules. The persistent namespace
//   stores normalized game metadata only; user-specific libraries and achievement state remain edge-cache data.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

export interface StaticAssetsBinding
{
    fetch ( request: Request ): Promise<Response>;
}

export interface KeyValueNamespaceBinding
{
    get ( key: string ): Promise<string | null>;
    put ( key: string, value: string, options: { expirationTtl: number } ): Promise<void>;
}

export interface WorkerEnvironment
{
    ASSETS:        StaticAssetsBinding;
    GAME_CACHE:    KeyValueNamespaceBinding;
    STEAM_API_KEY?: string;
}
