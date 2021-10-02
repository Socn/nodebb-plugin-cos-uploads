<h1><i class="fa fa-picture-o"></i> COS配置</h1>
<hr/>

<h3>Database Stored configuration:</h3>
<form id="s3-upload-bucket">
	<label for="s3bucket">Bucket</label><br/>
	<input type="text" id="s3bucket" name="bucket" value="{bucket}" title="S3 Bucket" class="form-control input-lg"
	       placeholder="S3 Bucket"><br/>

	<label for="s3host">Host</label><br/>
	<input type="text" id="s3host" name="host" value="{host}" title="S3 Host" class="form-control input-lg"
	       placeholder="website.com"><br/>

	<label for="s3path">Path</label><br/>
	<input type="text" id="s3path" name="path" value="{path}" title="S3 Path" class="form-control input-lg"
	       placeholder="/assets"><br/>

	<label for="aws-region">Region</label><br/>
	<input type="test" id="aws-region" name="region" title="AWS Region" class="form-control input-lg"
	       placeholder="COS Region"><br/>

	<button class="btn btn-primary" type="submit">Save</button>
</form>

<br><br>
<form id="s3-upload-credentials">
	<label for="bucket">Credentials</label><br/>
	<div class="alert alert-warning">
		Configuring this plugin using the fields below is <strong>NOT recommended</strong>, as it can be a potential
		security issue. We highly recommend that you investigate using either <strong>Environment Variables</strong> or
		<strong>Instance Meta-data</strong>
	</div>
	<input type="text" name="accessKeyId" value="{accessKeyId}" maxlength="20" title="Access Key ID"
	       class="form-control input-lg" placeholder="Access Key ID"><br/>
	<input type="text" name="secretAccessKey" value="{secretAccessKey}" title="Secret Access Key"
	       class="form-control input-lg" placeholder="Secret Access Key"><br/>
	<button class="btn btn-primary" type="submit">Save</button>
</form>

<script>
	$(document).ready(function () {

		$('#aws-region option[value="{region}"]').prop('selected', true)

		$("#s3-upload-bucket").on("submit", function (e) {
			e.preventDefault();
			save("cossettings", this);
		});

		$("#s3-upload-credentials").on("submit", function (e) {
			e.preventDefault();
			var form = this;
			bootbox.confirm("Are you sure you wish to store your credentials for accessing S3 in the database?", function (confirm) {
				if (confirm) {
					save("credentials", form);
				}
			});
		});

		function save(type, form) {
			var data = {
				_csrf: '{csrf}' || $('#csrf_token').val()
			};

			var values = $(form).serializeArray();
			for (var i = 0, l = values.length; i < l; i++) {
				data[values[i].name] = values[i].value;
			}

			$.post('{forumPath}api/admin/plugins/cos-uploads/' + type, data).done(function (response) {
				if (response) {
					//ajaxify.refresh();
					app.alertSuccess(response);
				}
			}).fail(function (jqXHR, textStatus, errorThrown) {
				//ajaxify.refresh();
				app.alertError(jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Error saving!');
			});
		}
	});
</script>
