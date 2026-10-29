import uuid
from django.db import models

class Investigation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    messages = models.JSONField(default=list)
    evidence = models.JSONField(default=list)
    solved = models.BooleanField(default=False)
    film_unlocked = models.BooleanField(default=False)
    film_solved = models.BooleanField(default=False)
    abandoned = models.BooleanField(default=False)
    chat_count = models.PositiveIntegerField(default=0)
    last_request_at = models.FloatField(default=0)
    busy_until = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ChannelBudget(models.Model):
    """Shared by every investigation/reset in the same browser session."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_count = models.PositiveIntegerField(default=0)
    last_request_at = models.FloatField(default=0)
    busy_until = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
