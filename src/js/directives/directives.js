'use strict';

function selectText(element) {
	var doc = document;
	if (doc.body.createTextRange) { // ms
		var range = doc.body.createTextRange();
		range.moveToElementText(element);
		range.select();
	} else if (window.getSelection) {
		var selection = window.getSelection();
		var range = doc.createRange();
		range.selectNodeContents(element);
		selection.removeAllRanges();
		selection.addRange(range);

	}
}

angular.module('copayApp.directives')
	.directive('validAddress', ['$rootScope', 'profileService',
		function ($rootScope, profileService) {
			return {
				require: 'ngModel',
				link: function (scope, elem, attrs, ctrl) {
					var ValidationUtils = require('trustnote-common/validation_utils.js');
					var validator = function (value) {
						if (!profileService.focusedClient)
							return;

						if (typeof value == 'undefined') {
							ctrl.$pristine = true;
							return;
						}

						// Regular url
						if (/^https?:\/\//.test(value)) {
							ctrl.$setValidity('validAddress', true);
							return value;
						}

						// trustnote uri
						var conf = require('trustnote-common/conf.js');
						var re = new RegExp('^' + conf.program + ':([A-Z2-7]{32})\b', 'i');
						var arrMatches = value.match(re);
						if (arrMatches) {
							ctrl.$setValidity('validAddress', ValidationUtils.isValidAddress(arrMatches[1]));
							return value;
						}

						// Regular Address
						ctrl.$setValidity('validAddress', ValidationUtils.isValidAddress(value));
						return value;
					};

					ctrl.$parsers.unshift(validator);
					ctrl.$formatters.unshift(validator);
				}
			};
		}
	])
	.directive('validUrl', [

		function () {
			return {
				require: 'ngModel',
				link: function (scope, elem, attrs, ctrl) {
					var validator = function (value) {
						// Regular url
						if (/^https?:\/\//.test(value)) {
							ctrl.$setValidity('validUrl', true);
							return value;
						} else {
							ctrl.$setValidity('validUrl', false);
							return value;
						}
					};

					ctrl.$parsers.unshift(validator);
					ctrl.$formatters.unshift(validator);
				}
			};
		}
	])
	.directive('validAmount', ['configService',
		function (configService) {

			return {
				require: 'ngModel',
				link: function (scope, element, attrs, ctrl) {
					var val = function (value) {
						//console.log('-- scope', ctrl);
						/*if (scope.home && scope.home.bSendAll){
                            console.log('-- send all');
                            ctrl.$setValidity('validAmount', true);
                            return value;
                        }*/
						//console.log('-- amount');
						var constants = require('trustnote-common/constants.js');
						var asset = attrs.validAmount;
						var settings = configService.getSync().wallet.settings;
						var unitValue = 1;
						var decimals = 0;
						if (asset === 'base') {
							unitValue = settings.unitValue;
							decimals = Number(settings.unitDecimals);
						}
						else if (asset === constants.BLACKBYTES_ASSET) {
							unitValue = settings.bbUnitValue;
							decimals = Number(settings.bbUnitDecimals);
						}

						var vNum = Number((value * unitValue).toFixed(0));

						if (typeof value == 'undefined' || value == 0) {
							ctrl.$pristine = true;
						}

						if (typeof vNum == "number" && vNum > 0) {
							var sep_index = ('' + value).indexOf('.');
							var str_value = ('' + value).substring(sep_index + 1);
							if (sep_index > 0 && str_value.length > decimals) {
								ctrl.$setValidity('validAmount', false);
							} else {
								ctrl.$setValidity('validAmount', true);
							}
						} else {
							ctrl.$setValidity('validAmount', false);
						}
						return value;
					}
					ctrl.$parsers.unshift(val);
					ctrl.$formatters.unshift(val);
				}
			};
		}
	])
	.directive('validFeedName', ['configService',
		function (configService) {

			return {
				require: 'ngModel',
				link: function (scope, elem, attrs, ctrl) {
					var validator = function (value) {
						var oracle = configService.oracles[attrs.validFeedName];
						if (!oracle || !oracle.feednames_filter) {
							ctrl.$setValidity('validFeedName', true);
							return value;
						}
						for (var i in oracle.feednames_filter) {
							var matcher = new RegExp(oracle.feednames_filter[i], "g");
							if (matcher.test(value)) {
								ctrl.$setValidity('validFeedName', true);
								return value;
							}
						}
						ctrl.$setValidity('validFeedName', false);
						return value;
					};

					ctrl.$parsers.unshift(validator);
					ctrl.$formatters.unshift(validator);
				}
			};
		}
	])
	.directive('validFeedValue', ['configService',
		function (configService) {

			return {
				require: 'ngModel',
				link: function (scope, elem, attrs, ctrl) {
					var validator = function (value) {
						var oracle = configService.oracles[attrs.validFeedValue];
						if (!oracle || !oracle.feedvalues_filter) {
							ctrl.$setValidity('validFeedValue', true);
							return value;
						}
						for (var i in oracle.feedvalues_filter) {
							var matcher = new RegExp(oracle.feedvalues_filter[i], "g");
							if (matcher.test(value)) {
								ctrl.$setValidity('validFeedValue', true);
								return value;
							}
						}
						ctrl.$setValidity('validFeedValue', false);
						return value;
					};

					ctrl.$parsers.unshift(validator);
					ctrl.$formatters.unshift(validator);
				}
			};
		}
	])
	.directive('loading', function () {
		return {
			restrict: 'A',
			link: function ($scope, element, attr) {
				var a = element.html();
				var text = attr.loading;
				element.on('click', function () {
					element.html('<i class="size-21 fi-bitcoin-circle icon-rotate spinner"></i> ' + text + '...');
				});
				$scope.$watch('loading', function (val) {
					if (!val) {
						element.html(a);
					}
				});
			}
		}
	})
	.directive('ngFileSelect', function () {
		return {
			link: function ($scope, el) {
				el.bind('change', function (e) {
					$scope.file = (e.srcElement || e.target).files[0];
					$scope.getFile();
				});
			}
		}
	})
	.directive('contact', ['addressbookService', function (addressbookService) {
		return {
			restrict: 'E',
			link: function (scope, element, attrs) {
				var addr = attrs.address;
				addressbookService.getLabel(addr, function (label) {
					if (label) {
						element.append(label);
					} else {
						element.append(addr);
					}
				});
			}
		};
	}])
	.directive('highlightOnChange', function () {
		return {
			restrict: 'A',
			link: function (scope, element, attrs) {
				scope.$watch(attrs.highlightOnChange, function (newValue, oldValue) {
					element.addClass('highlight');
					setTimeout(function () {
						element.removeClass('highlight');
					}, 500);
				});
			}
		}
	})
	.directive('checkStrength', function () {
		return {
			replace: false,
			restrict: 'EACM',
			require: 'ngModel',
			link: function (scope, element, attrs) {

				var MIN_LENGTH = 8;
				var MESSAGES = ['Very Weak', 'Very Weak', 'Weak', 'Medium', 'Strong', 'Very Strong'];
				var COLOR = ['#dd514c', '#dd514c', '#faa732', '#faa732', '#16A085', '#16A085'];

				function evaluateMeter(password) {
					var passwordStrength = 0;
					var text;
					if (password.length > 0) passwordStrength = 1;
					if (password.length >= MIN_LENGTH) {
						if ((password.match(/[a-z]/)) && (password.match(/[A-Z]/))) {
							passwordStrength++;
						} else {
							text = ', add mixed case';
						}
						if (password.match(/\d+/)) {
							passwordStrength++;
						} else {
							if (!text) text = ', add numerals';
						}
						if (password.match(/.[!,@,#,$,%,^,&,*,?,_,~,-,(,)]/)) {
							passwordStrength++;
						} else {
							if (!text) text = ', add punctuation';
						}
						if (password.length > 12) {
							passwordStrength++;
						} else {
							if (!text) text = ', add characters';
						}
					} else {
						text = ', that\'s short';
					}
					if (!text) text = '';

					return {
						strength: passwordStrength,
						message: MESSAGES[passwordStrength] + text,
						color: COLOR[passwordStrength]
					}
				}

				scope.$watch(attrs.ngModel, function (newValue, oldValue) {
					if (newValue && newValue !== '') {
						var info = evaluateMeter(newValue);
						scope[attrs.checkStrength] = info;
					}
				});
			}
		};
	})
	.directive('showFocus', function ($timeout) {
		return function (scope, element, attrs) {
			scope.$watch(attrs.showFocus,
				function (newValue) {
					$timeout(function () {
						newValue && element[0].focus();
					});
				}, true);
		};
	})
	.directive('match', function () {
		return {
			require: 'ngModel',
			restrict: 'A',
			scope: {
				match: '='
			},
			link: function (scope, elem, attrs, ctrl) {
				scope.$watch(function () {
					return (ctrl.$pristine && angular.isUndefined(ctrl.$modelValue)) || scope.match === ctrl.$modelValue;
				}, function (currentValue) {
					ctrl.$setValidity('match', currentValue);
				});
			}
		};
	})
	.directive('clipCopy', function () {
		return {
			restrict: 'A',
			scope: {
				clipCopy: '=clipCopy'
			},
			link: function (scope, elm) {
				// TODO this does not work (FIXME)
				elm.attr('tooltip', 'Press Ctrl+C to Copy');
				elm.attr('tooltip-placement', 'top');

				elm.bind('click', function () {
					selectText(elm[0]);
				});
			}
		};
	})
	.directive('menuToggle', function () {
		return {
			restrict: 'E',
			replace: true,
			templateUrl: 'views/includes/menu-toggle.html'
		}
	})
	.directive('logo', function () {
		return {
			restrict: 'E',
			scope: {
				width: "@",
				negative: "="
			},
			controller: function ($scope) {
				//$scope.logo_url = $scope.negative ? 'img/logo-negative.svg' : 'img/logo.svg';
				$scope.logo_url = $scope.negative ? 'img/icons/icon-white-32.png' : 'img/icons/icon-black-32.png';
			},
			replace: true,
			//template: '<img ng-src="{{ logo_url }}" alt="trustnote">'
			template: '<div><img ng-src="{{ logo_url }}" alt="Trustnote"><br>Trustnote</div>'
		}
	})
	.directive('availableBalance', function () {
		return {
			restrict: 'E',
			replace: true,
			templateUrl: 'views/includes/available-balance.html'
		}
	})
	.directive('selectable', function ($rootScope, $timeout) {
		return {
			restrict: 'A',
			scope: {
				bindObj: "=model",
				bindProp: "@prop",
				targetProp: "@exclusionBind"
			},
			link: function (scope, elem, attrs) {
				$timeout(function () {
					var dropdown = angular.element(document.querySelector(attrs.selectable));

					dropdown.find('li').on('click', function (e) {
						var li = angular.element(this);
						elem.html(li.find('a').find('span').eq(0).html());
						scope.bindObj[scope.bindProp] = li.attr('data-value');
						if (!$rootScope.$$phase) $rootScope.$digest();
					});
					scope.$watch(function (scope) {
						return scope.bindObj[scope.bindProp]
					}, function (newValue, oldValue) {
						angular.forEach(dropdown.find('li'), function (element) {
							var li = angular.element(element);
							if (li.attr('data-value') == newValue) {
								elem.html(li.find('a').find('span').eq(0).html());
								li.addClass('selected');
							} else {
								li.removeClass('selected');
							}
						});
					});
					var selected = false;
					angular.forEach(dropdown.find('li'), function (el) {
						var li = angular.element(el);
						var a = angular.element(li.find('a'));
						a.append('<i class="fi-check check"></i>');
						if (scope.bindObj[scope.bindProp] == li.attr('data-value')) {
							a[0].click();
							selected = true;
						}
					});
					if (!selected && typeof attrs.notSelected == "undefined") dropdown.find('a').eq(0)[0].click();

					if (scope.targetProp) {
						scope.$watch(function (scope) {
							return scope.bindObj[scope.targetProp]
						}, function (newValue, oldValue) {
							angular.forEach(dropdown.find('li'), function (element) {
								var li = angular.element(element);
								if (li.attr('data-value') != newValue) {
									li[0].click();
									scope.bindObj[scope.bindProp] = li.attr('data-value');
								}
							});
						});
					}
				});
			}
		};
	})
	.directive('keyboard', ['$compile',function($compile) {
		return {
			restrict : 'A',
			replace : true,
			transclude : true,
			template:'<input />',

			link : function(scope, element, attrs) {
				var keylist1=['q','w','e','r','t','y','u','i','o','p'];
				var keylist2=['a','s','d','f','g','h','j','k','l'];
				var keylist3=['z','x','c','v','b','n','m'];
				var calculator = '<div class="ngcalculator_area">'
					+'<div class="calculator">'
					+'<div class="inputarea">'
					+'<input type="text" id="text" ng-tap="getInput()" ng-change="'+attrs.ngChange+'" class="'+attrs.class+'" ng-model="' +attrs.ngModel+'">'
					+'</div><div class="con">'
					+'<div class="line1">';
				$.each(keylist1,function(k,v){
					calculator += '<div class="keyboard num key1" value="'+v+'">'+v+'</div>';
				});
				calculator += '</div><div class="line2">';
				$.each(keylist2,function(k,v){
					calculator += '<div class="keyboard num key2" value="'+v+'">'+v+'</div>';
				});
				calculator += '</div><div class="line3">'
					+ '<div class="keyboard blueIcon ensure">确定</div>';
				$.each(keylist3,function(k,v){
					calculator += '<div class="keyboard num key3" value="'+v+'">'+v+'</div>';
				});
				calculator += '<div class="keyboard blueIcon backstep">&nbsp;</div>'
					+'</div>'
					// +'<div class="keyboard blueIcon backstep">Bksp</div>'
					// +'<div class="keyboard blueIcon cleanup">清空</div>'
					// +'<div class="keyboard ensure ensure">确<br>定</div>'
					+'</div>'
					+'</div>'
					+'</div>';

				calculator = $compile(calculator)(scope);
				element.bind('focus',function(){
					$('.ngcalculator_area').removeClass('keyboardHidden');
					$('.ngcalculator_area').addClass('keyboardShow');
					document.body.appendChild(calculator[0]);
					document.activeElement.blur();
					$('.inptMnemonic').removeClass('active');
					element.addClass('active');
				});
				$(calculator[0]).find("input").focus(function(){
					document.activeElement.blur();
				});
				//关闭模态框
				$(calculator[0]).find(".close").click(function(){
					calculator[0].remove();
					var callback = attrs.callback;
					if(typeof callback!="undefined"){
						scope[callback]();
					}
				});
				//点击按钮 backupSubmit backupDelSeedSubmit recSubmit Last step top bar返回
				$('.keyCloseFlag').click(function () {
					$('.ngcalculator_area').removeClass('keyboardShow');
					$('.ngcalculator_area').addClass('keyboardHidden');
					$('.inptMnemonic').removeClass('active');
				});
				//退格
				$(calculator[0]).find(".backstep").click(function(){
					if(typeof $(calculator[0]).find("input").val()=="undefined"){
						$(calculator[0]).find("input").val("");
					}
					$(calculator[0]).find("input").val($(calculator[0]).find("input").val().substring(0,$(calculator[0]).find("input").val().length-1)).trigger('change');
				});
				//清空
				$(calculator[0]).find(".cleanup").click(function(){
					$(calculator[0]).find("input").val("").trigger('change');
				});
				//点击数字
				$(calculator[0]).find(".num").click(function(){
					var val = $(calculator[0]).find("input").val();
					var filter = attrs.filter;
					if(typeof filter!="undefined"){
						val = scope[filter](val,$(this).attr("value"));
					}else{
						val = val+''+$(this).attr("value");
					}
					$(calculator[0]).find("input").val(val).trigger('change');
					element.val(val).trigger('ngChange');
				});
				//确认$('.ngcalculator_area').removeClass('keyboardShow');$('.ngcalculator_area').addClass('keyboardHidden');
				$(calculator[0]).find(".ensure").click(function(){
					$('.ngcalculator_area').removeClass('keyboardShow');
					$('.ngcalculator_area').addClass('keyboardHidden');
					$('.inptMnemonic').removeClass('active');
				});
				//点击效果
				$(calculator[0]).find(".keyboard").click(function(){
					$(this).addClass("keydown");
					var that = this;
					setTimeout(function(){
						$(that).removeClass("keydown");
					},100)
				});
			}
		};
	}])