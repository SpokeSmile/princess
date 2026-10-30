from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('quest', '0004_investigation_date_story')]
    operations = [
        migrations.AddField(model_name='investigation', name='year_solved', field=models.BooleanField(default=False)),
    ]
