//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Normalized application API models. These types form the boundary returned to browser code and deliberately omit
//   raw Steam response fields that the application does not use.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

export interface UserSummary
{
    avatarUrl: string | null;
    personaName: string;
    profileUrl: string;
    steamId: string;
}

export type AchievementCapability = 'no' | 'unknown' | 'yes';

export interface GameSummary
{
    achievementCapability: AchievementCapability;
    achievementCount: number | null;
    appId: number;
    bannerUrl: string | null;
    iconUrl: string | null;
    name: string;
    playtimeMinutes: number;
}

export interface GameLibrarySummary
{
    discoveryCursor: string | null;
    games: GameSummary [];
}

export interface GameDiscoverySummary
{
    discoveryCursor: string | null;
    games: GameSummary [];
}

export interface AchievementDefinition
{
    apiName: string;
    description: string | null;
    iconGrayUrl: string | null;
    iconUrl: string | null;
    name: string;
}

export interface AchievementItemProgressDefinition
{
    apiName: string;
    internalKey: number;
    minimum: number;
    target: number;
}

export interface AchievementItemProgressSchema
{
    achievements: AchievementItemProgressDefinition [];
}

export interface AchievementSchema
{
    achievements: AchievementDefinition [];
}

export interface AchievementCapabilitySummary
{
    achievementCount: number;
    hasAchievements: boolean;
}

export interface PlayerAchievementState
{
    achieved: boolean;
    apiName: string;
    unlockTime: number | null;
}

export interface PlayerAchievementItemProgress
{
    current: number;
    internalKey: number;
}

export interface GlobalAchievementPercentage
{
    apiName: string;
    globalPercentage: number;
}

export interface GlobalAchievementRarity
{
    achievements: GlobalAchievementPercentage [];
}

export interface GameMetadata
{
    appId: number;
    bannerUrls: string [];
    iconUrl: string | null;
    libraryLogoUrls: string [];
    name: string;
}

export interface Achievement
{
    achieved: boolean;
    apiName: string;
    description: string | null;
    globalPercentage: number | null;
    iconGrayUrl: string | null;
    iconUrl: string | null;
    name: string;
    progress: AchievementItemProgress | null;
    unlockTime: number | null;
}

export interface AchievementItemProgress
{
    current: number;
    minimum: number;
    target: number;
}

export interface AchievementProgress
{
    percentage: number;
    total: number;
    unlocked: number;
}

export interface SelectedGameAchievements
{
    achievements: Achievement [];
    game: GameMetadata;
    progress: AchievementProgress;
}
