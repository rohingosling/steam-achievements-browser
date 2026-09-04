//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/locked-achievement-control.js
//
// Description:
//   Binds the native locked-achievement checkbox to frontend state. The module has no API dependency: a change updates
//   one boolean and asks the caller to redraw and announce the existing canonical achievement data.
//---------------------------------------------------------------------------------------------------------------------

import { setLockedAchievementVisibility } from './state.js';

//---------------------------------------------------------------------------------------------------------------------
// Function: bindLockedAchievementControl
//
// Description:
//
//   Binds locked achievement control events to the supplied controller and state callbacks.
//
// Parameters:
//
// - lockedControl (unknown):
//   The native checkbox controlling locked-achievement visibility.
//
// - state (unknown):
//   The mutable frontend state updated by the transition.
//
// - onVisibilityChange (unknown):
//   The callback invoked after locked-achievement visibility changes.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function bindLockedAchievementControl ( lockedControl, state, onVisibilityChange )
{
    lockedControl.addEventListener ( 'change', () =>
    {
        setLockedAchievementVisibility ( state, lockedControl.checked );
        onVisibilityChange ();
    } );
}
