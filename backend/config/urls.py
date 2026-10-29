from django.conf import settings
from django.urls import path, re_path
from django.views.static import serve
from quest import views

urlpatterns = [
    path('api/game/', views.game),
    path('api/evidence/', views.evidence),
    path('api/chat/', views.chat),
    path('api/guess/', views.guess),
    path('api/film/', views.film),
    path('api/reset/', views.reset),
    path('', views.frontend),
]
# Only these two public directories are exposed in development.
if settings.DEBUG:
    urlpatterns += [
        re_path(r'^src/(?P<path>.*)$', serve, {'document_root': settings.FRONTEND_DIR / 'src'}),
        re_path(r'^public/(?P<path>.*)$', serve, {'document_root': settings.FRONTEND_DIR / 'public'}),
    ]
