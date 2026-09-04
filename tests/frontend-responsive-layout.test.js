//---------------------------------------------------------------------------------------------------------------------
// File:
//   tests/frontend-responsive-layout.test.js
//
// Description:
//   Source-level verification of the Phase 12 two-card geometry and desktop/compact achievement control contracts.
//---------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const componentsSource = readFileSync ( new URL ( '../public/css/components.css', import.meta.url ), 'utf8' );
const indexSource      = readFileSync ( new URL ( '../public/index.html', import.meta.url ), 'utf8' );
const layoutSource     = readFileSync ( new URL ( '../public/css/layout.css', import.meta.url ), 'utf8' );
const tokensSource     = readFileSync ( new URL ( '../public/css/tokens.css', import.meta.url ), 'utf8' );

describe ( 'Responsive two-card layout', () =>
{
    it ( 'keeps the User ID card content-sized and the achievement card at the 960px, 100dvh target', () =>
    {
        expect ( tokensSource ).toContain ( '--card-width              : 960px;' );
        expect ( tokensSource ).toContain ( '--user-card-width         : 520px;' );
        expect ( layoutSource ).toContain ( '.user-card' );
        expect ( layoutSource ).toContain ( '.achievement-card' );
        expect ( layoutSource ).toContain ( 'height           : 100dvh;' );
        expect ( layoutSource ).toContain ( '.application[data-active-card="user-id"]' );
        expect ( layoutSource ).toContain ( 'overflow-y : auto;' );
    } );

    it ( 'separates the SteamID guidance from the Steam Support sentence', () =>
    {
        expect ( componentsSource ).toContain ( '.user-card__help p + p' );
        expect ( componentsSource ).toContain ( 'margin-top : var( --gap );' );
    } );

    it ( 'keeps Continue beside the input when space permits and gives it a full row on narrow screens', () =>
    {
        expect ( componentsSource ).toContain ( '.user-card__submit' );
        expect ( componentsSource ).toContain ( '.user-card__submit:focus-visible' );
        expect ( layoutSource ).toContain (
            'grid-template-columns : max-content minmax( 0, 1fr ) max-content;',
        );
        expect ( layoutSource ).toContain ( '@media ( max-width: 560px )' );
        expect ( layoutSource ).toContain ( '.user-card__field' );
        expect ( layoutSource ).toContain ( 'grid-template-columns : minmax( 0, 1fr );' );
        expect ( layoutSource ).toContain ( '.user-card__submit' );
        expect ( layoutSource ).toContain ( 'width      : 100%;' );
        expect ( layoutSource ).toContain (
            'min-height : calc( var( --control-height ) + 2 * var( --gap ) );',
        );
    } );

    it ( 'uses avatar and dynamic heading as one identity group with a non-truncating suffix', () =>
    {
        const avatarPosition  = indexSource.indexOf ( 'id="user-avatar"' );
        const personaPosition = indexSource.indexOf ( 'id="achievement-persona-name"' );
        const suffixPosition  = indexSource.indexOf ( '– Steam Achievements' );

        expect ( avatarPosition ).toBeGreaterThan ( 0 );
        expect ( avatarPosition ).toBeLessThan ( personaPosition );
        expect ( personaPosition ).toBeLessThan ( suffixPosition );
        expect ( indexSource ).toContain ( 'id="achievement-card-title" tabindex="-1"' );
        expect ( componentsSource ).toContain ( '.control-bar__persona' );
        expect ( componentsSource ).toContain ( 'text-overflow : ellipsis;' );
        expect ( componentsSource ).toContain ( '.control-bar__title-suffix' );
        expect ( componentsSource ).toContain ( 'white-space : pre;' );
    } );

    it ( 'orders Game, Sort, and checkbox with one compact control edge', () =>
    {
        const gamePosition       = indexSource.indexOf ( 'id="game-field"' );
        const sortPosition       = indexSource.indexOf ( 'id="sort-field"' );
        const checkboxPosition   = indexSource.indexOf ( 'id="show-locked-achievements"' );

        expect ( gamePosition ).toBeLessThan ( sortPosition );
        expect ( sortPosition ).toBeLessThan ( checkboxPosition );
        expect ( layoutSource ).toContain ( '@media ( max-width: 900px )' );
        expect ( layoutSource ).toContain ( 'grid-template-columns : max-content minmax( 0, 1fr );' );
        expect ( layoutSource ).toContain ( '.control-bar__identity' );
        expect ( layoutSource ).toContain ( 'grid-column : 1 / -1;' );
        expect ( layoutSource ).toContain ( '.control-bar__toggle' );
        expect ( layoutSource ).toContain ( '.control-bar__controls > .control-bar__toggle' );
        expect ( layoutSource ).toContain ( 'display : contents;' );
        expect ( indexSource ).not.toContain ( 'control-bar__field--user' );
    } );

    it ( 'keeps the achievement-list scrollbar visible even when the list does not overflow', () =>
    {
        const achievementListRule = layoutSource.match ( /\.achievement-list\s*\{[^}]+\}/ )?.[ 0 ] ?? '';

        expect ( achievementListRule ).toContain ( 'overflow-y       : scroll;' );
        expect ( achievementListRule ).toContain ( 'scrollbar-gutter : stable;' );
    } );

    it ( 'reserves a 26px footer in the enlarged bottom border for the project link', () =>
    {
        const footerPosition = indexSource.indexOf ( 'class="achievement-card__footer"' );
        const listPosition   = indexSource.indexOf ( 'class="achievement-card__block achievement-list-frame"' );

        expect ( footerPosition ).toBeGreaterThan ( listPosition );
        expect ( indexSource ).toContain (
            'href="https://github.com/rohingosling/steam-achievements-browser"',
        );
        expect ( indexSource ).toContain ( '>GitHub - Steam Achievements Browser</a>' );
        expect ( tokensSource ).toContain ( '--achievement-card-footer-height : 26px;' );
        expect ( tokensSource ).toContain ( '--font-size-card-footer   : 11px;' );
        expect ( layoutSource ).toContain ( '.achievement-card__footer' );
        expect ( layoutSource ).toContain ( 'flex             : 0 0 var( --achievement-card-footer-height );' );
        expect ( layoutSource ).toContain ( 'justify-content  : flex-end;' );
        expect ( layoutSource ).toContain ( 'padding-block-end : var( --gap );' );
        expect ( componentsSource ).toContain ( '.achievement-card__github-link' );
        expect ( componentsSource ).toContain ( 'font-size     : var( --font-size-card-footer );' );
        expect ( componentsSource ).toContain ( 'text-align    : right;' );
    } );

    it ( 'keeps every banner state at one responsive fixed height without cropping', () =>
    {
        const bannerRule = layoutSource.match ( /\.banner-header\s*\{[^}]+\}/ )?.[ 0 ] ?? '';
        const imageRule  = layoutSource.match ( /\.banner-header__image\s*\{[^}]+\}/ )?.[ 0 ] ?? '';
        const artworkRule = layoutSource.match ( /\.banner-header__artwork\s*\{[^}]+\}/ )?.[ 0 ] ?? '';
        const heroArtworkRule = layoutSource.match (
            /\.banner-header__artwork\[data-artwork-kind="library-hero"\]\s*\{[^}]+\}/,
        )?.[ 0 ] ?? '';
        const logoRule   = componentsSource.match ( /\.banner-header__game-logo\s*\{[^}]+\}/ )?.[ 0 ] ?? '';

        expect ( tokensSource ).toContain ( '--banner-header-height    : clamp( 180px, 32.3vw, 305px );' );
        expect ( bannerRule ).toContain ( 'height          : var( --banner-header-height );' );
        expect ( bannerRule ).toContain ( 'position        : relative;' );
        expect ( bannerRule ).not.toContain ( 'min-height' );
        expect ( bannerRule ).not.toContain ( 'margin-top' );
        expect ( bannerRule ).toContain ( 'overflow        : hidden;' );
        expect ( tokensSource ).not.toContain ( '--banner-header-space-top' );
        expect ( imageRule ).toContain ( 'max-width  : 100%;' );
        expect ( imageRule ).toContain ( 'max-height : 100%;' );
        expect ( imageRule ).toContain ( 'height     : auto;' );
        expect ( imageRule ).toContain ( 'object-fit : contain;' );
        expect ( indexSource ).toContain ( 'id="game-banner-artwork"' );
        expect ( indexSource ).toContain ( 'id="game-banner-logo"' );
        expect ( artworkRule ).toContain ( 'position        : relative;' );
        expect ( heroArtworkRule ).toContain ( 'width        : 100%;' );
        expect ( heroArtworkRule ).toContain ( 'aspect-ratio : 3840 / 1240;' );
        expect ( logoRule ).toContain ( 'position       : absolute;' );
        expect ( logoRule ).toContain ( 'bottom         : 20px;' );
        expect ( logoRule ).toContain ( 'left           : 20px;' );
        expect ( logoRule ).toContain ( 'max-width      : 42%;' );
        expect ( logoRule ).toContain ( 'max-height     : 40.6%;' );
        expect ( logoRule ).not.toContain ( 'transform' );
        expect ( logoRule ).toContain ( 'pointer-events : none;' );
    } );

    it ( 'uses the Steam logo and application title while no game is selected', () =>
    {
        expect ( indexSource ).toContain ( 'id="game-banner-fallback-logo"' );
        expect ( indexSource ).toContain ( 'src="images/ui/steam-logo.jpg"' );
        expect ( indexSource ).toContain (
            '<p class="banner-header__title" id="game-banner-fallback-text">Steam Achievement Browser</p>',
        );
        expect ( indexSource ).toContain (
            '<p class="banner-header__version" id="game-banner-fallback-version">Version 2.0.0</p>',
        );
        expect ( componentsSource ).toContain ( '.banner-header__logo' );
        expect ( componentsSource ).toContain ( '.banner-header__title' );
        expect ( componentsSource ).toContain ( '.banner-header__version' );
        expect ( componentsSource ).toContain ( 'font-size     : clamp( 18px, 5vw, var( --font-size-banner-title ) );' );
    } );

    it ( 'keeps the no-selection instruction in the list while showing zeroed progress', () =>
    {
        const appSource          = readFileSync ( new URL ( '../public/js/app.js', import.meta.url ), 'utf8' );
        const progressViewSource = readFileSync ( new URL ( '../public/js/progress-view.js', import.meta.url ), 'utf8' );

        expect ( indexSource ).toContain (
            '<p class="achievement-progress__summary" id="achievement-progress-summary"></p>',
        );
        expect ( appSource ).not.toContain ( 'Select a game to view achievement progress.' );
        expect ( appSource ).toContain ( "replaceAchievementListWithStatus ( 'Select a game to continue.' );" );
        expect ( appSource ).toContain ( 'renderNoGameSelectedProgress ();' );
        expect ( appSource ).toContain ( 'getAchievementProgressController ()?.renderNoGameSelected ();' );
        expect ( progressViewSource ).toContain ( "const NO_GAME_PROGRESS_SUMMARY = 'Achievements unlocked';" );
        expect ( progressViewSource ).toContain ( "percentage.textContent = '0 %';" );
    } );

    it ( 'aligns progress with the list content edge rather than a control width', () =>
    {
        expect ( componentsSource ).toContain (
            'padding-inline        : var( --gap ) calc( var( --gap ) + var( --scrollbar-width ) );',
        );
        expect ( componentsSource ).toContain ( 'width            : 100%;' );
        expect ( tokensSource ).not.toContain ( '--progress-width' );
    } );
} );
