# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    AttendanceCheckInEndpoint,
    AttendanceCheckOutEndpoint,
    AttendanceStatusEndpoint,
)

# User-scoped, so no workspace slug. `plane.app.urls` is mounted at `api/`,
# which makes these `/api/attendance/...` -- unrelated to Plane's own public
# `/api/v1/`, and unrelated again to the bridge's `/api/v1/` on the Odoo host.
urlpatterns = [
    path("attendance/me/", AttendanceStatusEndpoint.as_view(), name="attendance-status"),
    path("attendance/check-in/", AttendanceCheckInEndpoint.as_view(), name="attendance-check-in"),
    path("attendance/check-out/", AttendanceCheckOutEndpoint.as_view(), name="attendance-check-out"),
]
