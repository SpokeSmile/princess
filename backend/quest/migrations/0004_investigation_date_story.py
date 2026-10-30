from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('quest', '0003_investigation_abandoned_investigation_film_solved_and_more')]
    operations = [
        migrations.AddField(model_name='investigation', name='month_solved', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='investigation', name='stamp_solved', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='investigation', name='letter_opened', field=models.BooleanField(default=False)),
        migrations.AddField(model_name='investigation', name='hints', field=models.JSONField(default=dict)),
        migrations.AddField(model_name='investigation', name='revision', field=models.PositiveIntegerField(default=0)),
    ]
